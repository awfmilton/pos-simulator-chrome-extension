/**
 * SimTourContext - helper methods for tour actions
 */

class SimTourContext {
    constructor(engine) {
        this.engine = engine;
    }

    async switchTab(tabName) {
        if (window.posSimulator && typeof window.posSimulator.switchTab === 'function') {
            window.posSimulator.switchTab(tabName);
            // Small delay to allow tab panel to animate in
            await this.sleep(300);
        } else {
            console.warn('posSimulator.switchTab not available');
        }
    }

    async fillField(selector, value) {
        const el = document.querySelector(selector);
        if (el) {
            el.value = value;
            // Trigger input/change events
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            console.warn(`Element not found for fillField: ${selector}`);
        }
    }

    async click(selector) {
        const el = document.querySelector(selector);
        if (el) {
            el.click();
        } else {
            console.warn(`Element not found for click: ${selector}`);
        }
    }

    async clickAndWait(selector, delay = 500) {
        await this.click(selector);
        await this.sleep(delay);
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async waitForElement(selector, timeout = 3000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (document.querySelector(selector)) return true;
            await this.sleep(100);
        }
        return false;
    }

    // High-level narration helper if needed
    log(msg) {
        console.log(`[Tour] ${msg}`);
    }
}

window.SimTourContext = SimTourContext;
