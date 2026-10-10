export interface Communication {
 version:1;
 state:"classified"|"unclassified"|"no_preference";
 scope:{language:boolean;script:boolean;brevity:boolean};
 language:"english"|"hindi"|"hinglish"|null;
 script:"roman"|"devanagari"|null;
 brevity:"short"|"detailed"|null;
}
export declare const COMMUNICATION_VALUES:Readonly<{language:readonly string[];script:readonly string[];brevity:readonly string[]}>;
export declare function validCommunication(value:unknown):value is Communication;
export declare function communicationFromProposal(value:unknown):Communication|null;
export declare const COMMUNICATION_PROPOSAL_SCHEMA:Readonly<Record<string,unknown>>;
export declare const COMMUNICATION_EXTRACTION_RULE:string;
