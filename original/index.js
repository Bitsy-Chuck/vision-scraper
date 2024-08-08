import {ChatOpenAI} from "@langchain/openai";
import {RunnableSequence, RunnableWithMessageHistory} from "@langchain/core/runnables";
import {ChatPromptTemplate} from "@langchain/core/prompts";
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// Add these imports at the top of the file
import fs, {createReadStream} from 'fs';
import readline from 'readline';
import dotenv from 'dotenv';
import {fileURLToPath} from 'url';
import {dirname} from 'path';
import {InMemoryChatMessageHistory} from "@langchain/core/chat_history";
import {HumanMessage} from "@langchain/core/messages";
import {logger} from "../utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

puppeteer.use(StealthPlugin());
const messageHistories = {};
const timeout = 5000;


// Replace the existing static_history object with this
let static_history = {};

// Add these functions after the other function definitions
function loadStaticContent() {
    try {
        const data = fs.readFileSync('static_content.json', 'utf8');
        return JSON.parse(data);
    } catch (err) {
        // console.log('No existing static content found. Creating a new one.');
        logger.error('No existing static content found. Creating a new one.');
        return {};
    }
}

function saveStaticContent(content) {
    fs.writeFileSync('static_content.json', JSON.stringify(content, null, 2));
}

// In the main async function, add this line after the browser is launched
static_history = loadStaticContent();

async function image_to_base64(image_file) {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(image_file);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base64Data = buffer.toString('base64');
            const dataURI = `data:image/jpeg;base64,${base64Data}`;
            resolve(dataURI);
        });
        stream.on('error', reject);
    });
}

async function input(text) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let elementMap = new Map();
let nextElementId = 1;

async function updateElementMap(page) {
    await page.evaluate(() => {
        document.querySelectorAll('[gpt-interactable]').forEach(e => e.removeAttribute("gpt-interactable"));
    });

    const elements = await page.$$(
        "a, button, input[type='submit'], input[type='button'], input[type='text'], input[type='password'], input[type='email'], textarea, select, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch'], [role='option'], [onclick]"
    );

    elementMap.clear();
    nextElementId = 1;

    await Promise.all(elements.map(async (e) => {
        const elementId = nextElementId++;
        await page.evaluate((el, id) => {
            function isElementVisible(el) {
                if (!el) return false;

                const isStyleVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    return style.width !== '0' && style.height !== '0' && style.opacity !== '0' &&
                        style.display !== 'none' && style.visibility !== 'hidden';
                };

                const isElementInViewport = (el) => {
                    const rect = el.getBoundingClientRect();
                    return (
                        rect.top >= 0 && rect.left >= 0 &&
                        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                    );
                };

                if (!isStyleVisible(el)) return false;

                let parent = el;
                while (parent) {
                    if (!isStyleVisible(parent)) return false;
                    parent = parent.parentElement;
                }

                return isElementInViewport(el);
            }

            el.style.border = "1px solid red";
            el.setAttribute('gpt-element-id', id);

            const position = el.getBoundingClientRect();

            if (position.width > 5 && position.height > 5 && isElementVisible(el)) {
                let interactableText = el.textContent.trim();
                if (!interactableText) {
                    interactableText = el.getAttribute('aria-label') ||
                        el.getAttribute('title') ||
                        el.getAttribute('name') ||
                        el.getAttribute('id') ||
                        el.getAttribute('placeholder') ||
                        'Unnamed interactable element';
                }
                interactableText = interactableText.replace(/[^a-zA-Z0-9 ]/g, '');
                el.setAttribute("gpt-interactable", interactableText);
                el.setAttribute("gpt-element-type", el.tagName.toLowerCase());
            }
        }, e, elementId);
        elementMap.set(elementId, {
            element: e,
            type: await e.evaluate(el => el.tagName.toLowerCase()),
            text: await e.evaluate(el => el.getAttribute("gpt-interactable") || el.textContent.trim())
        });
    }));

    return Object.fromEntries(elementMap);
}

async function clickElementById(page, elementId) {
    const element = elementMap.get(elementId);
    if (element) {
        await element.element.click();
        await page.waitForNavigation({waitUntil: 'networkidle0'}).catch(() => {
        });
    } else {
        // console.log(`Element with ID ${elementId} not found`);
        logger.error(`Element with ID ${elementId} not found`);
    }
}

async function inputTextById(page, elementId, inputValue) {
    const element = elementMap.get(elementId);
    if (element) {
        await element.element.type(inputValue);
    } else {
        // console.log(`Element with ID ${elementId} not found`);
        logger.error(`Element with ID ${elementId} not found`);

    }
}

async function loadWebsiteAndTakeScreenshot(browser, url) {
    // console.log('Loading website and taking screenshot...');
    logger.info('Loading website and taking screenshot...');
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle0'});
    const updatedElementMap = await updateElementMap(page);
    await page.screenshot({path: 'screenshot.jpg', fullPage: true});
    // console.log(`Screenshot taken. ✨`);
    logger.info(`Screenshot taken. ✨`);
    return {page, elementMap: updatedElementMap};
}

async function processActions(page, browser, actions) {
    let urlAction = actions.find(action => action.type === 'url');
    let inputActions = actions.filter(action => action.type === 'input');
    let clickActions = actions.filter(action => action.type === 'click');

    if (urlAction) {
        // console.log(`Navigating to ${urlAction.value}`);
        logger.info(`Navigating to ${urlAction.value}`);
        const result = await loadWebsiteAndTakeScreenshot(browser, urlAction.value);
        return {page: result.page, screenshotTaken: true, elementMap: result.elementMap};
    }

    for (const action of inputActions) {
        // console.log(`Inputting text into element with ID ${action.elementId}`);
        logger.info(`Inputting text into element with ID ${action.elementId}`);
        await inputTextById(page, action.elementId, action.value);
    }

    for (const action of clickActions) {
        // console.log(`Clicking on element with ID ${action.elementId}`);
        logger.info(`Clicking on element with ID ${action.elementId}`);
        await clickElementById(page, action.elementId);
    }

    const updatedElementMap = await updateElementMap(page);
    await page.screenshot({path: "screenshot.jpg", fullPage: true});
    return {page, screenshotTaken: true, elementMap: updatedElementMap};
}

function extractJSONWithSchema(text) {
    function findJSONObjects(str) {
        const objects = [];
        let depth = 0;
        let start = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if (inString) {
                if (char === '"' && !escapeNext) inString = false;
                escapeNext = char === '\\' && !escapeNext;
            } else {
                if (char === '{') {
                    if (depth === 0) start = i;
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        objects.push(str.substring(start, i + 1));
                        start = -1;
                    }
                } else if (char === '"') {
                    inString = true;
                }
            }
        }

        return objects;
    }

    function isValidSchema(obj) {
        return obj &&
            typeof obj === 'object' &&
            Array.isArray(obj.actions) &&
            obj.actions.every(action =>
                action &&
                typeof action === 'object' &&
                ['url', 'click', 'input'].includes(action.type) &&
                typeof action.value === 'string' &&
                (action.type !== 'click' && action.type !== 'input' || typeof action.elementId === 'number')
            ) &&
            Array.isArray(obj.order_of_execution) &&
            obj.order_of_execution.every(index =>
                Number.isInteger(index) &&
                index >= 0 &&
                index < obj.actions.length
            );
    }

    const jsonObjects = findJSONObjects(text);
    return jsonObjects
        .map(jsonStr => {
            try {
                return JSON.parse(jsonStr);
            } catch {
                return null;
            }
        })
        .filter(isValidSchema);
}

(async () => {
    console.log("###########################################");
    console.log("# GPT4V-Browsing by Unconventional Coding #");
    console.log("###########################################\n");

    const browser = await puppeteer.launch({
        headless: false,
    });

    const system_prompt = `You are a website crawler. You will be given instructions on what to do by browsing.
     You are connected to a web browser and you will be given the screenshot of the website you are on.
      The interactable elements on the website will be highlighted in red in the screenshot and have unique IDs.
       Always read what is in the screenshot. Don't guess element names.

    You can interact with the website by providing a JSON object with the following schema:
    
    {{
      "actions": [
        {{
          "type": "url" | "input" | "click",
          "value": string,
          "elementId": number (for input and click actions)
        }}
      ],
      "order_of_execution": [0, 1, 2] // Array of indices of actions in the order they should be executed
    }}
    
    Do not include any explanation in the JSON object. Only output the JSON object.
    
    - For navigating to a URL: {{"type": "url", "value": "https://example.com"}}
    - For inputting text: {{"type": "input", "value": "text_to_input", "elementId": 1}}
    - For clicking elements: {{"type": "click", "value": "text_written_in_element", "elementId": 2}}
    
    Important rules:
    1. Always keep url action separate from other actions.
    2. Input actions should always be followed by a submission action (e.g., clicking a submit button).
    3. Do not guess elements unless you see them in a screenshot attached by the user.
    4. Use the provided elementMap to reference interactable elements on the page.
    
    Current elementMap:
    {element_map}
    
    Once you are on a URL and you have found the answer to the user's question, you can answer with a regular message.
    
    `;

    const printIntermediateStage = (input) => {
        // console.log("Intermediate stage - Input to the model:");
        // console.log(JSON.stringify(input, null, 2));
        logger.info("Intermediate stage - Input to the model:");
        logger.info(JSON.stringify(input, null, 2));
        return JSON.stringify(input);
    };

    const promptTemplate = ChatPromptTemplate.fromMessages([
        ["system", system_prompt],
        ["placeholder", "{chat_history}"],
        ["human", "{input}"],
    ]);

    const model = new ChatOpenAI({model: "gpt-4o"});
    const chain = RunnableSequence.from([
        promptTemplate,
        printIntermediateStage,
        model,
    ]);

    const inputInsightModel = new ChatOpenAI({model: "gpt-4o"});
    const inputValueChain = RunnableSequence.from([
        ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful agent who has to come up with accurate information to fill in the elements. " +
            "You do not get another chance to come up with the input value. Please provide an appropriate input value for the field." +
            " You can refer to the context provided. Only return the value to be filled in the form. Be precise. If single word is needed, provide that."],
            ["human", "Generate an appropriate input value for the field '{fieldName}'. Context: {context}"],
            ["placeholder", "{chat_history}"]
        ]),
        printIntermediateStage,
        inputInsightModel,
    ]);

    const inputValueChainWithMesssageHistory = new RunnableWithMessageHistory({
        runnable: inputValueChain,
        getMessageHistory: async (sessionId) => {
            if (!messageHistories[sessionId]) {
                messageHistories[sessionId] = new InMemoryChatMessageHistory();
            }
            const t = messageHistories[sessionId];
            logger.info("t", t);
            return t;
        },
        inputMessagesKey: "input",
        historyMessagesKey: "chat_history",
    });

    const withMessageHistory = new RunnableWithMessageHistory({
        runnable: chain,
        getMessageHistory: async (sessionId) => {
            if (!messageHistories[sessionId]) {
                messageHistories[sessionId] = new InMemoryChatMessageHistory();
            }
            const t = messageHistories[sessionId];
            logger.info("t", t);
            return t;
        },
        inputMessagesKey: "input",
        historyMessagesKey: "chat_history",
    });

    let currentPage;
    let currentElementMap = {};
    let usr_input = await input("Enter your initial instruction: ");
    let screenshot_taken = false;
    const config = {
        configurable: {
            sessionId: "abc2",
        },
    };

    while (true) {
        if (screenshot_taken) {
            const base64_image = await image_to_base64("screenshot.jpg");
            usr_input = new HumanMessage(
                {
                    content: [{
                        type: "image_url",
                        image_url: `"${base64_image}"`,
                    }, {
                        type: "text",
                        text: "Here's the screenshot of the website you are on right now." +
                            " You can interact with elements by providing a JSON object with actions and order of execution." +
                            " If you find the answer to the user's question, you can respond normally." +
                            " If you think there is an error, give a critical analysis of what is the error and what is the easiest way" +
                            " without much steps that can be done to fix the error or navigate to the correct page." +
                            " Remember, if you need to navigate to a new URL, provide that as a separate action." +
                            " If something cannot be confirmed, do not include it in the actions. Only output a single json array of actions, No explanation. Output only in json format" +
                            " Also, ensure that input actions are always followed by a submission action." +
                            " Important: Club all the clicks and inputs on a single screenshot together and order by the order of execution. You will not see the same page again."
                    }
                    ]
                }
            );
            screenshot_taken = false;
        }

        const response = await withMessageHistory.invoke(
            {
                input: JSON.stringify(usr_input),
                static_history: JSON.stringify(static_history),
                element_map: JSON.stringify(currentElementMap)
            },
            config
        );

        const message_text = response.content;
        // console.log("GPT: " + message_text);
        logger.info("GPT: " + message_text);

        const jsonObjects = extractJSONWithSchema(message_text);
        if (jsonObjects.length > 0) {
            for (let i = 0; i < jsonObjects.length; i++) {
                let jsonObject = jsonObjects[i];
                for (let j = 0; j < jsonObject.actions.length; j++) {
                    let action = jsonObject.actions[j];
                    if (action.type === 'input') {
                        const element = elementMap.get(action.elementId);
                        if (!element) {
                            console.log(`Element with ID ${action.elementId} not found`);
                            throw new Error(`Element with ID ${action.elementId} not found`);
                        }
                        if (!currentPage) {
                            // console.log("No page loaded yet. Please provide a URL action first.");
                            logger.warn("No page loaded yet. Please provide a URL action first.");
                            continue;
                        }
                        const fieldName = await currentPage.evaluate(el => el.getAttribute('gpt-interactable'), element.element);

                        // Check if the field value exists in static_history
                        if (fieldName in static_history) {
                            action.value = static_history[fieldName];
                        } else {
                            // If not in static_history, ask the user
                            const userInput = await input(`Please provide a value for the field '${fieldName}': `);
                            action.value = userInput;

                            // Save the user input to static_history
                            static_history[fieldName] = userInput;
                            saveStaticContent(static_history);
                        }

                        // If still no value, use the AI model as a fallback
                        if (!action.value) {
                            const previousActions = jsonObject.actions.slice(0, j);
                            const val = await inputValueChainWithMesssageHistory.invoke({
                                fieldName: fieldName,
                                context: `Current page: ${currentPage.url()}, Previous actions: ${JSON.stringify(previousActions)}`
                            });
                            action.value = val.content;
                        }
                    }
                }
                const result = await processActions(currentPage, browser, jsonObject.actions);
                currentPage = result.page;
                currentElementMap = result.elementMap;
                screenshot_taken = result.screenshotTaken;

                if (screenshot_taken) {
                    break;
                }
            }
        } else {
            usr_input = await input("You: ");
            console.log();
        }
    }
})();
