/**
 * SimTourEngine - Core logic for the standalone tour
 */

class SimTourEngine {
    constructor() {
        this.steps = [];
        this.currentIndex = -1;
        this.ctx = new window.SimTourContext(this);
        this.isActive = false;

        this.overlayEl = null;
        this.coachMarkEl = null;
        this.spotlightEl = null;

        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    start(steps) {
        if (this.isActive) return;

        this.steps = steps;
        this.currentIndex = 0;
        this.isActive = true;

        this._initUI();
        this._showCurrentStep();

        window.addEventListener('keydown', this._handleKeyDown);
        document.body.classList.add('tour-active');
    }

    next() {
        if (this.currentIndex < this.steps.length - 1) {
            this.currentIndex++;
            this._showCurrentStep();
        } else {
            this.stop();
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this._showCurrentStep();
        }
    }

    stop() {
        this.isActive = false;
        this.currentIndex = -1;

        if (this.overlayEl) this.overlayEl.remove();
        if (this.coachMarkEl) this.coachMarkEl.remove();

        window.removeEventListener('keydown', this._handleKeyDown);
        document.body.classList.remove('tour-active');

        this.overlayEl = null;
        this.coachMarkEl = null;
    }

    /**
     * Show a single highlight step without full tour navigation.
     * Used for cross-app coordination where the POS drives the walkthrough.
     */
    async showAdHocStep(step) {
        // Stop any active standalone tour
        if (this.isActive) this.stop();

        this._initUI();
        this.currentIndex = 0;
        this.steps = [step];

        // Ensure target exists before showing
        const targetEl = step.target ? document.querySelector(step.target) : null;

        // Add ad-hoc styling (pulse highlight)
        if (this.spotlightEl) {
            this.spotlightEl.classList.add('tour-spotlight-pulse');
        }

        this._updateUI();

        // Hide navigation buttons for ad-hoc steps
        const footer = this.coachMarkEl.querySelector('.tour-footer');
        if (footer) footer.style.display = 'none';
        const closeBtn = this.coachMarkEl.querySelector('.tour-close-btn');
        if (closeBtn) {
            // Re-wire close button to also remove ad-hoc styling
            closeBtn.onclick = () => {
                this.stop();
                if (this.spotlightEl) this.spotlightEl.classList.remove('tour-spotlight-pulse');
            };
        }
    }

    _initUI() {
        // Overlay for spotlight (using box-shadow trick)
        this.overlayEl = document.createElement('div');
        this.overlayEl.className = 'tour-overlay';

        // Spotlight element itself
        this.spotlightEl = document.createElement('div');
        this.spotlightEl.className = 'tour-spotlight';
        this.overlayEl.appendChild(this.spotlightEl);

        document.body.appendChild(this.overlayEl);

        // Coach mark (popover)
        this.coachMarkEl = document.createElement('div');
        this.coachMarkEl.className = 'tour-coach-mark';
        document.body.appendChild(this.coachMarkEl);
    }

    async _showCurrentStep() {
        const step = this.steps[this.currentIndex];
        if (!step) return;

        // 1. Switch tab if required
        if (step.tab) {
            await this.ctx.switchTab(step.tab);
        }

        // 2. Dwell if required
        if (step.dwell > 0) {
            await this.ctx.sleep(step.dwell);
        }

        // 3. Execute action
        if (typeof step.action === 'function') {
            try {
                await step.action(this.ctx);
            } catch (e) {
                console.error(`Error in tour step action ${step.id}:`, e);
            }
        }

        // 4. Update UI (spotlight + coach mark)
        this._updateUI();
    }

    _updateUI() {
        const step = this.steps[this.currentIndex];
        const targetEl = step.target ? document.querySelector(step.target) : null;

        // Update Spotlight
        if (targetEl) {
            const rect = targetEl.getBoundingClientRect();
            const padding = 8;
            this.spotlightEl.style.display = 'block';
            this.spotlightEl.style.top = `${rect.top - padding}px`;
            this.spotlightEl.style.left = `${rect.left - padding}px`;
            this.spotlightEl.style.width = `${rect.width + padding * 2}px`;
            this.spotlightEl.style.height = `${rect.height + padding * 2}px`;

            // Scroll into view if needed
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            this.spotlightEl.style.display = 'none';
        }

        // Update Coach Mark — build via explicit DOM construction (no innerHTML;
        // see extension CLAUDE.md "No innerHTML" convention + MV3 CSP hardening)
        const isLast = this.currentIndex === this.steps.length - 1;

        // Header
        const header = document.createElement('div');
        header.className = 'tour-header';
        const h3 = document.createElement('h3');
        h3.textContent = step.title;
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tour-close-btn';
        closeBtn.textContent = '×';
        header.appendChild(h3);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.className = 'tour-body';
        body.textContent = step.body;

        // Footer
        const footer = document.createElement('div');
        footer.className = 'tour-footer';
        const progress = document.createElement('span');
        progress.className = 'tour-progress';
        progress.textContent = `${this.currentIndex + 1} / ${this.steps.length}`;
        const buttons = document.createElement('div');
        buttons.className = 'tour-buttons';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'tour-btn tour-prev-btn';
        prevBtn.textContent = 'Back';
        prevBtn.disabled = this.currentIndex === 0;
        const nextBtn = document.createElement('button');
        nextBtn.className = 'tour-btn tour-next-btn';
        nextBtn.textContent = isLast ? 'Finish' : 'Next';
        buttons.appendChild(prevBtn);
        buttons.appendChild(nextBtn);
        footer.appendChild(progress);
        footer.appendChild(buttons);

        // Mount (clears any previous content, then appends fresh nodes)
        this.coachMarkEl.replaceChildren(header, body, footer);

        // Wire buttons
        closeBtn.onclick = () => this.stop();
        prevBtn.onclick = () => this.prev();
        nextBtn.onclick = () => this.next();

        // Position Coach Mark
        this._positionCoachMark(targetEl, step.placement);
    }

    _positionCoachMark(targetEl, placement) {
        if (!targetEl) {
            // Center if no target
            this.coachMarkEl.style.top = '50%';
            this.coachMarkEl.style.left = '50%';
            this.coachMarkEl.style.transform = 'translate(-50%, -50%)';
            return;
        }

        const targetRect = targetEl.getBoundingClientRect();
        const cmRect = this.coachMarkEl.getBoundingClientRect();
        const gap = 16;

        let top, left;
        this.coachMarkEl.style.transform = 'none';

        switch (placement) {
            case 'top':
                top = targetRect.top - cmRect.height - gap;
                left = targetRect.left + (targetRect.width / 2) - (cmRect.width / 2);
                break;
            case 'bottom':
                top = targetRect.bottom + gap;
                left = targetRect.left + (targetRect.width / 2) - (cmRect.width / 2);
                break;
            case 'left':
                top = targetRect.top + (targetRect.height / 2) - (cmRect.height / 2);
                left = targetRect.left - cmRect.width - gap;
                break;
            case 'right':
                top = targetRect.top + (targetRect.height / 2) - (cmRect.height / 2);
                left = targetRect.right + gap;
                break;
            case 'center':
            default:
                top = '50%';
                left = '50%';
                this.coachMarkEl.style.transform = 'translate(-50%, -50%)';
                break;
        }

        // Clamp to screen
        if (top !== '50%') {
            top = Math.max(gap, Math.min(top, window.innerHeight - cmRect.height - gap));
            left = Math.max(gap, Math.min(left, window.innerWidth - cmRect.width - gap));

            this.coachMarkEl.style.top = `${top}px`;
            this.coachMarkEl.style.left = `${left}px`;
        }
    }

    _handleKeyDown(e) {
        if (!this.isActive) return;

        switch (e.key) {
            case 'Escape':
                this.stop();
                break;
            case 'ArrowRight':
                this.next();
                break;
            case 'ArrowLeft':
                this.prev();
                break;
        }
    }
}

window.simTourEngine = new SimTourEngine();
