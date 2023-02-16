declare module 'wikibase-sdk' {
    export interface wikibaseSdk {
        getEntities(q : any) : string,
        searchEntities(q : string) : string
    }

    export default function wdk(props : any) : wikibaseSdk;

}