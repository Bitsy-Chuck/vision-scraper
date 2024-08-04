let elementMap = new Map();
let nextElementId = 1;

export async function updateElementMap(page) {
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

export { elementMap };
