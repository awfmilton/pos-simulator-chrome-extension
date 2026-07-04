/**
 * ontological types for the Simulator Walkthrough
 */

class SimTourStep {
    constructor({ id, feature, tab, target, title, body, placement = 'bottom', dwell = 0, action = null }) {
        if (!id) throw new Error('SimTourStep requires an id');
        if (!title) throw new Error(`SimTourStep ${id} requires a title`);
        if (!body) throw new Error(`SimTourStep ${id} requires a body`);

        this.id = id;
        this.feature = feature;
        this.tab = tab;
        this.target = target;
        this.title = title;
        this.body = body;
        this.placement = placement; // 'top', 'bottom', 'left', 'right', 'center'
        this.dwell = dwell; // ms to wait before showing this step (after tab switch etc)
        this.action = action; // function(ctx)

        Object.freeze(this);
    }
}

class SimTourSection {
    constructor({ id, title, icon, tab, steps = [] }) {
        if (!id) throw new Error('SimTourSection requires an id');
        if (!title) throw new Error(`SimTourSection ${id} requires a title`);

        this.id = id;
        this.title = title;
        this.icon = icon;
        this.tab = tab;
        this.steps = steps.map(s => s instanceof SimTourStep ? s : new SimTourStep(s));

        Object.freeze(this);
    }
}

window.SimTourStep = SimTourStep;
window.SimTourSection = SimTourSection;
