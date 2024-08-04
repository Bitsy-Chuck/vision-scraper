import dotenv from 'dotenv';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {setupChatChain} from './chatChain.js';
import {loadWebsiteAndTakeScreenshot, processActions} from './browserActions.js';
import {input} from './utils.js';

dotenv.config();
puppeteer.use(StealthPlugin());

const messageHistories = {};
let static_history = {
    "username": "singhtejasv9@gmail.com ",
    "password": "@wESOME11",
};

async function analyzeScreenshot(withMessageHistory, config, screenshot, url, elementMap, isFirstAnalysis) {
    const content = isFirstAnalysis ?
        [
            {
                type: "image_url",
                image_url: screenshot,
            },
            {
                type: "text",
                text: `Analyze this screenshot of ${url}. Provide a detailed description of the current screen, including all visible elements, forms, navigation items, and any error or success messages. Pay special attention to elements highlighted with a red outline and light red background, as these are interactable elements. Here's a map of all interactable elements: ${JSON.stringify(elementMap)}`
            }
        ] :
        [
            {
                type: "text",
                text: screenshot // This will be the elaborate context in subsequent calls
            }
        ];

    const analysis = await withMessageHistory.invoke(
        {
            input: JSON.stringify(content),
            static_history: JSON.stringify(static_history),
            element_map: JSON.stringify(elementMap)
        },
        config
    );

    return analysis.content;
}

async function createElaborateContext(previousActions, mainGoal, userInput, sessionMetadata, environmentalFactors, elementMap) {
    return {
        "current_screen_analysis": {
            "page_title": "", // Extract from analysis
            "url": sessionMetadata.current_url,
            // "main_content_summary": analysis, // Use the full analysis here
            "visible_sections": [], // Extract from analysis if possible
            "form_fields": [], // Extract from analysis if possible
            "navigation_menu_items": [], // Extract from analysis if possible
            "error_messages": [], // Extract from analysis if possible
            "success_messages": [], // Extract from analysis if possible
            "highlighted_elements": Object.values(elementMap)
        },
        "previous_actions": previousActions,
        "current_screen_goal": {
            "primary_objective": "", // To be determined based on main goal and current screen
            "success_criteria": [],
            "constraints": []
        },
        "main_goal": mainGoal,
        "available_actions": Object.values(elementMap).map(el => ({
            "action_type": el.type === 'a' ? 'click' : el.type === 'input' ? 'input' : 'click',
            "target_element": {
                "element_id": el.elementId,
                "element_text": el.text,
                "element_type": el.type
            },
            "expected_outcome": `Interact with ${el.text}`
        })),
        "user_input": userInput,
        "session_metadata": sessionMetadata,
        "environmental_factors": environmentalFactors,
    };
}

async function determineEnvironmentalFactors(page) {
    return page.evaluate(() => {
        return {
            "detected_language": document.documentElement.lang || "en",
            "user_agent": navigator.userAgent,
            "screen_resolution": `${window.screen.width}x${window.screen.height}`,
            "connection_speed": navigator.connection ? navigator.connection.effectiveType : "unknown"
        };
    });
}

async function handleInputAction(action, currentPage, previousActions, inputValueChain, currentElementMap) {
    const element = currentElementMap[action.target.element_id];
    if (!element) {
        console.log(`Element with ID ${action.target.element_id} not found`);
        throw new Error(`Element with ID ${action.target.element_id} not found`);
    }
    if (!currentPage) {
        console.log("No page loaded yet. Please provide a URL action first.");
        return action.value;
    }
    const fieldName = element.text;
    const resp = await inputValueChain.invoke({
        fieldName: fieldName,
        static_history: JSON.stringify(static_history),
        context: `Current page: ${currentPage.url()}, Previous actions: ${JSON.stringify(previousActions)}`
    });
    return extractJSONWithSchemaBasic(resp.content);
}


let sessionMetadata = {
    "start_time": new Date().toISOString(),
    "current_time": new Date().toISOString(),
    "pages_visited": [],
    "total_actions_performed": 0
};

(async () => {
    console.log("###########################################");
    console.log("# GPT4V-Browsing by Unconventional Coding #");
    console.log("###########################################\n");

    const browser = await puppeteer.launch({
        headless: false,
        // executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google\ Chrome',
        // userDataDir: '/Users/ojasvsingh/Library/Application Support/Google/Chrome/Default',
    });

    const page = await browser.newPage();

    await page.setViewport({
        width: 1200,
        height: 1200,
        deviceScaleFactor: 1,
    });

    const {withMessageHistory, inputValueChain} = await setupChatChain(messageHistories);

    let currentPage;
    let currentElementMap = {};
    let currentScreenshot;
    let isFirstAnalysis = true;
    let mainGoal = {
        "overall_objective": "Login to linkedIn and apply to jobs with easy apply available",//await input("Enter your main goal: "),
        "success_criteria": [],
        "constraints": [],
        "progress": {
            "completed_steps": [],
            "next_steps": [],
            "blockers": []
        }
    };

    const config = {
        configurable: {
            sessionId: "abc2",
        },
    };

    if (!currentPage) {
        const initialUrl = await input("Enter the initial URL to start browsing: ");
        const result = await loadWebsiteAndTakeScreenshot(browser, initialUrl);
        currentPage = result.page;
        currentScreenshot = result.screenshot;
        currentElementMap = result.elementMap;
        sessionMetadata.pages_visited.push(initialUrl);
        sessionMetadata.current_url = initialUrl;
    }
    while (true) {

        // const analysis = await analyzeScreenshot(withMessageHistory, config, currentScreenshot, sessionMetadata.current_url, currentElementMap, isFirstAnalysis);
        const environmentalFactors = await determineEnvironmentalFactors(currentPage);
        let previousActions = []
        const elaborateContext = await createElaborateContext(
            // analysis,
            previousActions,
            mainGoal,
            {"latest_command": "", "timestamp": new Date().toISOString(), "parsed_intent": ""},
            sessionMetadata,
            environmentalFactors,
            currentElementMap
        );

        let inp = [{
            type: "image_url",
            image_url: currentScreenshot,
        },
            {
                type: "text",
                text: "This is the screenshot of current screen. "
            }
        ]

        if (isFirstAnalysis) {
            isFirstAnalysis = false;
            currentScreenshot = JSON.stringify(elaborateContext);
        }

        const response = await withMessageHistory.invoke(
            {
                input: JSON.stringify(inp),
                static_history: JSON.stringify(static_history),
                element_map: JSON.stringify(currentElementMap),
                context: JSON.stringify(elaborateContext)
            },
            config
        );

        const message_text = response.content;
        console.log("GPT: " + message_text);

        const responseDTO = extractJSONWithSchemaBasic(message_text);
        const jsonObjects = [responseDTO];
        if (jsonObjects.length > 0) {
            for (const jsonObject of jsonObjects) {
                console.log("Reasoning:", jsonObject.reasoning);
                console.log("Plan:", JSON.stringify(jsonObject.plan, null, 2));

                for (let j = 0; j < jsonObject.plan.proposed_actions.length; j++) {
                    let action = jsonObject.plan.proposed_actions[j];
                    if (action.action_type === 'input') {
                        const inputValueResponse = await handleInputAction(action, currentPage, jsonObject.plan.proposed_actions.slice(0, j), inputValueChain, currentElementMap);
                        console.log(`Input value response: ${inputValueResponse.value}`);
                        action.value = inputValueResponse.value;
                    }
                }
                const result = await processActions(currentPage, browser, jsonObject.plan.proposed_actions);
                currentPage = result.page;
                currentScreenshot = result.screenshot;
                currentElementMap = result.elementMap;

                // Check if the page has changed
                const newUrl = await currentPage.url();
                if (sessionMetadata.current_url !== newUrl) {
                    isFirstAnalysis = true;
                    sessionMetadata.current_url = newUrl;
                    if (!sessionMetadata.pages_visited.includes(newUrl)) {
                        sessionMetadata.pages_visited.push(newUrl);
                    }
                }
            }
        } else {
            const userInput = await input("You: ");
            elaborateContext.user_input = {
                "latest_command": userInput,
                "timestamp": new Date().toISOString(),
                "parsed_intent": "" // You might want to add intent parsing here
            };
        }

        sessionMetadata.current_time = new Date().toISOString();
    }
})();

function extractJSONWithSchemaBasic(text) {
    // remove ```json string and ``` from the text
    text = text.replace(/```json/g, '');
    text = text.replace(/```/g, '');
    return JSON.parse(text);
}

function extractJSONWithSchema(text) {
    const jsonRegex = /{[\s\S]*?}/g;
    const jsonMatches = text.match(jsonRegex);

    if (!jsonMatches) return [];

    return jsonMatches.map(jsonString => {
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            console.error("Failed to parse JSON:", e);
            return null;
        }
    }).filter(obj => obj !== null);
}

function extractJSONWithSchemaAdv(text) {
    // First, try to find JSON within code blocks
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;
    let jsonObjects = [];

    while ((match = codeBlockRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1]);
            if (parsed && typeof parsed === 'object') {
                jsonObjects.push(parsed);
            }
        } catch (e) {
            console.error("Failed to parse JSON from code block:", e);
        }
    }

    // If no valid JSON found in code blocks, try to find JSON in the text directly
    if (jsonObjects.length === 0) {
        const jsonRegex = /{[\s\S]*?}/g;
        const jsonMatches = text.match(jsonRegex);

        if (jsonMatches) {
            jsonObjects = jsonMatches.map(jsonString => {
                try {
                    return JSON.parse(jsonString);
                } catch (e) {
                    console.error("Failed to parse JSON:", e);
                    return null;
                }
            }).filter(obj => obj !== null);
        }
    }

    return jsonObjects;
}
