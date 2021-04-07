declare module 'lice-js' {
    interface LicenseWithBody {
        body : string;
        header : null;
    }
    interface LicenseWithHeader {
        body : null;
        header : string;
    }

    export function createLicense(license : string, options : {
        header : true,
        organization : string,
        project : string,
        year : string
    }, cb : (error : Error|null, license : LicenseWithHeader) => void) : void;
    export function createLicense(license : string, options : {
        header : false,
        organization : string,
        project : string,
        year : string
    }, cb : (error : Error|null, license : LicenseWithBody) => void) : void;
    export function createLicense(license : string, options : {
        header : boolean,
        organization : string,
        project : string,
        year : string
    }, cb : (error : Error|null, license : LicenseWithHeader|LicenseWithBody) => void) : void;
}
