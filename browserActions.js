// import { logger } from './utils.js';

import {logger} from "./utils.js";

export async function loadWebsiteAndTakeScreenshot(browser, url) {
    logger.info(`Loading website and taking screenshot: ${url}`);
    try {
        const page = await browser.newPage();
        await page.goto(url, {waitUntil: 'networkidle0'});
        const {screenshot, elementMap} = await takeScreenshotWithHighlights(page);
        logger.info(`Screenshot taken for ${url}`);
        return {page, screenshot, elementMap};
    } catch (error) {
        logger.error(`Error loading website and taking screenshot: ${error.message}`);
        throw error;
    }
}

export async function processActions(page, browser, actions) {
    logger.info(`Processing ${actions.length} actions`);
    for (const action of actions) {
        try {
            switch (action.action_type) {
                case 'url':
                    logger.info(`Navigating to ${action.value}`);
                    return await loadWebsiteAndTakeScreenshot(browser, action.value);
                case 'input':
                    logger.info(`Inputting text into element with ID ${action.target.element_id}`);
                    await inputTextById(page, action.target.element_id, action.value);
                    break;
                case 'click':
                    logger.info(`Clicking on element with ID ${action.target.element_id}`);
                    let _page = (await browser.pages());
                    // await page.waitForNavigation({waitUntil: 'networkidle0'});
                    logger.info(`Page loaded`);
                    await Promise.all([
                        clickElementById(page, action.target.element_id),
                        page.waitForNavigation()
                    ]).catch(() => {
                    });
                    break;
                case 'wait':
                    logger.info(`Waiting for ${action.value} milliseconds`);
                    await page.waitForTimeout(parseInt(action.value));
                    break;
                case 'scroll':
                    logger.info(`Scrolling ${action.value}`);
                    await scrollPage(page, action.value);
                    break;
                default:
                    logger.warn(`Unknown action type: ${action.action_type}`);
            }

            // let previousActions = [];
            // previousActions.push({
            //     action_type: action.action_type,
            //     target_element: action.target ? `${action.target.element_text} (ID: ${action.target.element_id})` : '',
            //     value: action.value,
            //     timestamp: new Date().toISOString(),
            //     result: "Executed" // You might want to capture the actual result
            // });
            // sessionMetadata.total_actions_performed++;
        } catch (error) {
            logger.error(`Error processing action ${action.action_type}: ${error.message}`);
            throw error;
        }
    }

    const {screenshot, elementMap} = await takeScreenshotWithHighlights(page);
    return {page, screenshot, elementMap};
}

async function takeScreenshotWithHighlights(page) {
    await highlightInteractableElements(page);
    const screenshot = await page.screenshot({
        type: "webp",
        encoding: "base64",
        fullPage: true,
        captureBeyondViewport: false,
        quality: 10,
    });
    // const screenshot_min = resizedataURL(screenshot, 800, 600);
    const elementMap = await updateElementMap(page);
    return {screenshot: `data:image/png;base64,${screenshot}`, elementMap};
}

/**
 * Highlights interactable elements on a page and returns their details.
 * @param {import('puppeteer').Page} page - The Puppeteer page object
 * @returns {Promise<Array<{elementId: number, text: string, type: string, bbox: {x: number, y: number, width: number, height: number}}>>}
 */
async function highlightInteractableElements(page) {
    return await page.evaluate(() => {
        const elements = document.querySelectorAll('a, button, input, textarea, select');
        const elementDetails = [];

        elements.forEach((el, index) => {
            const elementId = index + 1;
            el.setAttribute('gpt-element-id', elementId);

            // Highlight the element
            el.style.outline = '2px solid red';
            el.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';

            // Get bounding box
            const bbox = el.getBoundingClientRect();

            // Create label for element ID
            const label = document.createElement('div');
            label.textContent = elementId;
            label.style.position = 'absolute';
            label.style.top = `${bbox.top}px`;
            label.style.left = `${bbox.left}px`;
            label.style.backgroundColor = 'red';
            label.style.color = 'white';
            label.style.padding = '2px';
            label.style.fontSize = '12px';
            label.style.zIndex = '10000';
            document.body.appendChild(label);

            // Extract text content
            let text = '';
            const tagName = el.tagName.toLowerCase();

            switch (tagName) {
                case 'input':
                    switch (el.type.toLowerCase()) {
                        case 'submit':
                        case 'button':
                            text = el.value || el.name || '';
                            break;
                        case 'image':
                            text = el.alt || el.name || '';
                            break;
                        default:
                            text = el.value || el.placeholder || el.name || '';
                    }
                    break;
                case 'select':
                    text = Array.from(el.options).find(option => option.selected)?.text || el.name || '';
                    break;
                case 'button':
                    text = el.textContent.trim() || el.value || el.name || '';
                    break;
                default:
                    text = el.textContent.trim();
            }

            // If text is still empty, try to get it from aria-label or title
            if (!text) {
                text = el.getAttribute('aria-label') ||
                    el.getAttribute('title') ||
                    el.getAttribute('name') ||
                    el.getAttribute('id') ||
                    '';
            }

            // If text is still empty, try to get any text from child elements
            if (!text) {
                text = Array.from(el.childNodes)
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent.trim())
                    .join(' ') || '';
            }

            // If text is still empty, use a placeholder based on the element type
            if (!text) {
                text = `[${tagName.toUpperCase()}]`;
            }

            // Truncate long text
            text = text.substring(0, 50) + (text.length > 50 ? '...' : '');

            // Store element details
            elementDetails.push({
                elementId,
                text,
                type: tagName,
                bbox: {
                    x: bbox.x,
                    y: bbox.y,
                    width: bbox.width,
                    height: bbox.height
                }
            });
        });

        return elementDetails;
    });
}

async function updateElementMap(page) {
    return await page.evaluate(() => {
        const elements = document.querySelectorAll('[gpt-element-id]');
        const elementMap = {};
        elements.forEach(el => {
            const id = el.getAttribute('gpt-element-id');
            elementMap[id] = {
                elementId: id,
                text: el.innerText || el.value || el.placeholder || '',
                type: el.tagName.toLowerCase(),
                isVisible: el.offsetParent !== null
            };
        });
        return elementMap;
    });
}

async function clickElementById(page, elementId) {
    try {
        await page.evaluate((id) => {
            const element = document.querySelector(`[gpt-element-id="${id}"]`);
            if (element) {
                element.click();
            } else {
                throw new Error(`Element with ID ${id} not found`);
            }
        }, elementId);
        await page.waitForNavigation({waitUntil: 'networkidle0'}).catch(() => {
        });
    } catch (error) {
        logger.error(`Error clicking element with ID ${elementId}: ${error.message}`);
        throw error;
    }
}

async function inputTextById(page, elementId, inputValue) {
    try {
        await page.evaluate((id, value) => {
            const element = document.querySelector(`[gpt-element-id="${id}"]`);
            if (element) {
                element.value = value;
            } else {
                throw new Error(`Element with ID ${id} not found`);
            }
        }, elementId, inputValue);
    } catch (error) {
        logger.error(`Error inputting text into element with ID ${elementId}: ${error.message}`);
        throw error;
    }
}

async function scrollPage(page, direction) {
    try {
        switch (direction) {
            case 'down':
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                break;
            case 'up':
                await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
                break;
            case 'bottom':
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                break;
            case 'top':
                await page.evaluate(() => window.scrollTo(0, 0));
                break;
            default:
                logger.warn(`Unknown scroll direction: ${direction}`);
        }
    } catch (error) {
        logger.error(`Error scrolling page ${direction}: ${error.message}`);
        throw error;
    }
}
