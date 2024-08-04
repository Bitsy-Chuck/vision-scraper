import dotenv from 'dotenv';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {setupChatChain} from '../chatChain.js';
import {processActions} from '../browserActions.js';
import {input} from '../utils.js';

dotenv.config();
puppeteer.use(StealthPlugin());

const messageHistories = {};
let static_history = {
    "username": "admin",
    "password": "pass",
};

(async () => {
    console.log("###########################################");
    console.log("# GPT4V-Browsing by Unconventional Coding #");
    console.log("###########################################\n");

    const browser = await puppeteer.launch({
        headless: false,
    });

    const {withMessageHistory, inputValueChain} = await setupChatChain(messageHistories);

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
            usr_input = await createUserInputWithScreenshot();
            screenshot_taken = false;
        }

        const response = await withMessageHistory.invoke(
            {
                input: usr_input,
                static_history: JSON.stringify(static_history),
                element_map: JSON.stringify(currentElementMap)
            },
            config
        );

        const message_text = response.content;
        console.log("GPT: " + message_text);

        const jsonObjects = extractJSONWithSchema(message_text);
        if (jsonObjects.length > 0) {
            for (const jsonObject of jsonObjects) {
                for (let j = 0; j < jsonObject.actions.length; j++) {
                    let action = jsonObject.actions[j];
                    if (action.type === 'input') {
                        action.value = await handleInputAction(action, currentPage, jsonObject.actions.slice(0, j), inputValueChain);
                    }
                }
                const result = await processActions(currentPage, browser, jsonObject.actions);
                currentPage = result.page;
                currentElementMap = result.elementMap;
                screenshot_taken = result.screenshotTaken;

                if (screenshot_taken) break;
            }
        } else {
            usr_input = await input("You: ");
            console.log();
        }
    }
})();

async function createUserInputWithScreenshot() {
    const base64_image = await image_to_base64("screenshot.jpg");
    return {
        content: [{
            type: "image_url",
            image_url: base64_image,
        }, {
            type: "text",
            text: "Here's the screenshot of the website you are on right now. You can interact with elements by providing a JSON object with actions and order of execution." +
                " If you find the answer to the user's question, you can respond normally." +
                " If you think there is an error, give a critical analysis of what is the error and what is the easiest way without much steps that can be done to fix the error or navigate to the correct page." +
                " Remember, if you need to navigate to a new URL, provide that as a separate action." +
                " If something cannot be confirmed, do not include it in the actions." +
                " Only output a single json array of actions, No explanation." +
                " Output only in json format. Also, ensure that input actions are always followed by a submission action." +
                " Important: Club all the clicks and inputs on a single screenshot together and order by the order of execution." +
                " You will not see the same page again."
        }]
    };
}

async function handleInputAction(action, currentPage, previousActions, inputValueChain) {
    const element = elementMap.get(action.elementId);
    if (!element) {
        console.log(`Element with ID ${action.elementId} not found`);
        throw new Error(`Element with ID ${action.elementId} not found`);
    }
    if (!currentPage) {
        console.log("No page loaded yet. Please provide a URL action first.");
        return action.value;
    }
    const fieldName = await currentPage.evaluate(el => el.getAttribute('gpt-interactable'), element.element);
    return inputValueChain.invoke({
        fieldName: fieldName,
        context: `Current page: ${currentPage.url()}, Previous actions: ${JSON.stringify(previousActions)}`
    });
}
