/**
 * Registry for SimTourSections
 */

class SimTourRegistry {
    constructor() {
        this.sections = new Map();
    }

    register(section) {
        if (!(section instanceof window.SimTourSection)) {
            section = new window.SimTourSection(section);
        }
        this.sections.set(section.id, section);
        return section;
    }

    getSection(id) {
        return this.sections.get(id);
    }

    getAllSections() {
        return Array.from(this.sections.values());
    }

    getFullTourSteps() {
        let allSteps = [];
        for (const section of this.sections.values()) {
            allSteps = allSteps.concat(section.steps);
        }
        return allSteps;
    }
}

// Singleton instance
window.simTourRegistry = new SimTourRegistry();
