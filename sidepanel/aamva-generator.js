/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/
/**
 * AAMVA PDF417 Barcode Generator
 * Generates random, compliant AAMVA test data for driver's licenses.
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
            hairColors: ["BLK", "BLN", "BRO", "GRY", "RED", "SDY", "WHT"]
        };
    }

    // Utility to pick a random element from an array
    _getRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // Utility to generate a random number string of a given length
    _getRandomNumeric(len) {
        return Math.random().toString().slice(2, 2 + len);
    }

    // Utility to format a date as MMDDCCYY
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

    // Main generation method
    generate() {
        const dates = this._generateDates();
        const state = this._getRandom(this.data.states);

        const fields = {
            // Header
            complianceIndicator: "@",
            dataElementSeparator: "\n",
            recordSeparator: String.fromCharCode(30),
            segmentTerminator: "\r",
            fileType: "ANSI ",

            // Data Payload
            issuerId: this._getRandomNumeric(6),
            aamvaVersion: "08",
            jurisdictionVersion: "01",
            numEntries: "15", // Number of data elements in the subfile
            firstName: `DAC${this._getRandom(this.data.firstNames)}`,
            lastName: `DCS${this._getRandom(this.data.lastNames)}`,
            middleName: `DAD${this._getRandom(this.data.middleNames)}`,
            dob: `DBB${dates.dob}`,
            sex: `DBC${Math.random() > 0.5 ? '1' : '2'}`,
            street: `DAG${this._getRandomNumeric(4)} ${this._getRandom(this.data.streetNames)} ${this._getRandom(this.data.streetTypes)}`,
            city: `DAI${this._getRandom(this.data.cities)}`,
            state: `DAJ${state}`,
            postalCode: `DAK${this._getRandomNumeric(5)}`,
            issueDate: `DBD${dates.issue}`,
            expirationDate: `DBA${dates.expiration}`,
            height: `DAU${this._getRandomNumeric(2)} in`,
            eyeColor: `DAY${this._getRandom(this.data.eyeColors)}`,
            hairColor: `DAZ${this._getRandom(this.data.hairColors)}`,
            licenseId: `DAQ${state}${this._getRandomNumeric(8)}`
        };

        const header = `${fields.complianceIndicator}${fields.dataElementSeparator}${fields.recordSeparator}${fields.segmentTerminator}${fields.fileType}${fields.issuerId}${fields.aamvaVersion}${fields.jurisdictionVersion}${fields.numEntries}${fields.dataElementSeparator}`;

        const subfileDesignator = "DL";

        const payload = [
            fields.firstName,
            fields.lastName,
            fields.middleName,
            fields.dob,
            fields.sex,
            fields.street,
            fields.city,
            fields.state,
            fields.postalCode,
            fields.issueDate,
            fields.expirationDate,
            fields.height,
            fields.eyeColor,
            fields.hairColor,
            fields.licenseId
        ].join(fields.dataElementSeparator);

        // Construct the final string with Header, Subfile Designator, and Payload
        return `${header}${subfileDesignator}${fields.dataElementSeparator}${payload}${fields.dataElementSeparator}`;
    }
}
