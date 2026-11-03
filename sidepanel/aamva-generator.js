/*
Copyright (c) Alexander Milton
Developed by: Alexander Milton
Version: 2.1
Website: https://github.com/awfmilton/pos-simulator-chrome-extension
License: MPL-2.0 (https://mozilla.org/MPL/2.0/)
*/

/**
 * AAMVA PDF417 Barcode Generator
 * Generates random, compliant AAMVA test data for driver's licenses and ID cards.
 */
class AAMVAGenerator {
    constructor() {
        this.data = {
            firstNames: ["JOHN", "JANE", "ROBERT", "MARY", "MICHAEL", "PATRICIA", "WILLIAM", "JENNIFER"],
            lastNames: ["SMITH", "JOHNSON", "WILLIAMS", "BROWN", "JONES", "GARCIA", "MILLER", "DAVIS"],
            middleNames: ["JAMES", "MARIE", "LEE", "ANN", "JOSEPH", "KAY", "DAVID", "LYNN"],
            streetNames: ["MAIN", "OAK", "PINE", "MAPLE", "ELM", "WASHINGTON", "PARK", "CEDAR"],
            streetTypes: ["ST", "AVE", "RD", "LN", "BLVD", "DR", "CT"],
            cities: ["ANYTOWN", "SPRINGFIELD", "FAIRVIEW", "RIVERSIDE", "GREENVILLE", "MADISON"],
            states: ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"],
            eyeColors: ["BLK", "BLU", "BRO", "GRY", "GRN", "HAZ", "MAR", "PNK"],
            hairColors: ["BLK", "BLN", "BRO", "GRY", "RED", "SDY", "WHT"],
            cardTypes: ["DL", "ID"] // Driver's License or ID Card
        };
    }

    // Utility to pick a random element from an array
    _getRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // Utility to generate a random number string of a given length
    _getRandomNumeric(len) {
        return Math.random().toString().slice(2, 2 + len).padStart(len, '0');
    }

    // Utility to format a date as MMDDYYYY (8 chars, exactly as the parser's formatDate expects)
    _formatDate(date) {
        const mm = (date.getMonth() + 1).toString().padStart(2, '0');
        const dd = date.getDate().toString().padStart(2, '0');
        const ccyy = date.getFullYear().toString();
        return `${mm}${dd}${ccyy}`;
    }

    // Generate random dates for DOB, issue, and expiration
    _generateDates() {
        const now = new Date();
        const dob = new Date(now.getFullYear() - (18 + Math.floor(Math.random() * 40)), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
        const issueDate = new Date(dob.getFullYear() + 16 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
        const expirationDate = new Date(issueDate.getFullYear() + 4, issueDate.getMonth(), issueDate.getDate());

        return {
            dob: this._formatDate(dob),
            issue: this._formatDate(issueDate),
            expiration: this._formatDate(expirationDate)
        };
    }

    /**
     * FIX (Bug 3): Generate dates for an exact age.
     * DOB is computed as exactly `age` years before today, so the
     * person has *just* turned `age` (worst-case cutoff for testing).
     * @param {number} age - Exact age in whole years
     */
    _generateDatesForAge(age) {
        const now = new Date();
        // DOB: same month/day as today but `age` years ago
        const dob = new Date(now.getFullYear() - age, now.getMonth(), now.getDate());
        const issueDate = new Date(dob.getFullYear() + 16, dob.getMonth(), dob.getDate());
        const expirationDate = new Date(issueDate.getFullYear() + 5, issueDate.getMonth(), issueDate.getDate());

        return {
            dob: this._formatDate(dob),
            issue: this._formatDate(issueDate),
            expiration: this._formatDate(expirationDate)
        };
    }

    // Calculate height in inches and format properly
    _generateHeight() {
        const heightInches = 60 + Math.floor(Math.random() * 18); // 5'0" to 6'6"
        const feet = Math.floor(heightInches / 12);
        const inches = heightInches % 12;
        return `${feet}${inches.toString().padStart(2, '0')}`;
    }

    // Generate weight in pounds
    _generateWeight() {
        return (120 + Math.floor(Math.random() * 180)).toString().padStart(3, '0'); // 120-300 lbs
    }

    // Main generation method
    // FIX (Bug 3): accepts optional `age` to generate a deterministic DOB for testing
    generate(cardType = null, age = null) {
        const dates = (age !== null && Number.isFinite(age))
            ? this._generateDatesForAge(age)
            : this._generateDates();
        const state = this._getRandom(this.data.states);
        const selectedCardType = cardType || this._getRandom(this.data.cardTypes);

        // AAMVA Header format: @[RS]ANSI [IIN][Version][Jurisdiction Version][Number of Entries][CR]
        // FIX (Bug 1): The RS immediately precedes "ANSI" — no CR in between.
        //              Inserting \r here breaks the parser regex /^@[\u001e\x1e]?ANSI\s(\d{6})(\d{6})/
        // FIX (Bug 2): Fields within the subfile are CR-delimited (\r) per AAMVA spec and
        //              match the existing parser test fixtures (e.g. DBB08241955\r...).
        const complianceIndicator = "@";
        const dataElementSeparator = "\r"; // FIX: CR (\r) is the correct AAMVA field delimiter
        const recordSeparator = "\x1e";    // ASCII RS (Record Separator) — placed directly before ANSI
        const segmentTerminator = "\r";    // kept for subfile trailing terminator use only

        // File format
        const fileType = "ANSI ";
        const issuerId = this._getRandomNumeric(6);
        const aamvaVersion = "08"; // Version 8
        const jurisdictionVersion = "00"; // Updated to 00 for better compatibility
        const numEntries = "01"; // One subfile

        // FIX (Bug 1): Header is @[RS]ANSI...[CR] — no segmentTerminator between RS and "ANSI"
        const header = `${complianceIndicator}${recordSeparator}${fileType}${issuerId}${aamvaVersion}${jurisdictionVersion}${numEntries}${dataElementSeparator}`;

        // Subfile designator (DL for Driver's License, ID for ID Card)
        const subfileDesignator = selectedCardType;

        // Calculate proper subfile length and build data elements
        const dataElements = [
            `DAC${this._getRandom(this.data.firstNames)}`, // Customer First Name
            `DCS${this._getRandom(this.data.lastNames)}`,  // Customer Family Name
            `DAD${this._getRandom(this.data.middleNames)}`, // Customer Middle Name
            `DBB${dates.dob}`, // Date of Birth
            `DBC${Math.random() > 0.5 ? '1' : '2'}`, // Physical Description – Sex (1=M, 2=F)
            `DAY${this._getRandom(this.data.eyeColors)}`, // Physical Description – Eye Color
            `DAU${this._generateHeight()}`, // Physical Description – Height
            `DAG${this._getRandomNumeric(4)} ${this._getRandom(this.data.streetNames)} ${this._getRandom(this.data.streetTypes)}`, // Address – Street 1
            `DAI${this._getRandom(this.data.cities)}`, // Address – City
            `DAJ${state}`, // Address – Jurisdiction Code
            `DAK${this._getRandomNumeric(5)}${Math.random() > 0.5 ? '-' + this._getRandomNumeric(4) : ''}`, // Address – Postal Code
            `DAQ${state}${this._getRandomNumeric(9)}`, // Customer ID Number
            `DBD${dates.issue}`, // Document Issue Date
            `DBA${dates.expiration}`, // Document Expiration Date
            `DCA${selectedCardType === 'DL' ? this._getRandomClass() : 'NONE'}`, // Vehicle Class (for DL) or NONE (for ID)
            `DCB${selectedCardType === 'DL' ? 'NONE' : 'NONE'}`, // Restriction Codes
            `DCD${selectedCardType === 'DL' ? 'NONE' : 'NONE'}`, // Endorsement Codes
            `DAZ${this._getRandom(this.data.hairColors)}`, // Physical Description – Hair Color
            `DCF${this._getRandomNumeric(10)}`, // Document Discriminator
            `DCG${state}`, // Country Identification
            `DDG${Math.random() > 0.5 ? '0' : '1'}`, // Limited Duration Document Indicator
            `DAW${this._generateWeight()}` // Weight (Pounds)
        ];

        // Build the subfile data
        const subfileData = dataElements.join(dataElementSeparator);

        // Calculate subfile length (including designator and terminator)
        const subfileContent = `${subfileDesignator}${dataElementSeparator}${subfileData}${dataElementSeparator}`;
        const subfileLength = subfileContent.length.toString(16).toUpperCase().padStart(6, '0');

        // Final barcode format
        const finalBarcode = `${header}${subfileLength}${subfileContent}`;

        console.log(`[AAMVA Generator] Generated ${selectedCardType} barcode with ${dataElements.length} data elements`);

        return finalBarcode;
    }

    // Generate random vehicle class for driver's licenses
    _getRandomClass() {
        const classes = ['A', 'B', 'C', 'CDL', 'M'];
        return this._getRandom(classes);
    }

    // Generate a specific type of card
    // FIX (Bug 3): all public methods now forward the `age` param
    generateDriversLicense(age = null) {
        return this.generate('DL', age);
    }

    generateIDCard(age = null) {
        return this.generate('ID', age);
    }

    // Legacy method for backward compatibility
    generateAAMVA(age = null) {
        return this.generate(null, age);
    }
}
