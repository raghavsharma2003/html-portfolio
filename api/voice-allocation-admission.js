import {q} from './_db.js';
import {createVoiceAllocationAdmissionHandler} from './_voice/allocation-admission-handler.js';
export default createVoiceAllocationAdmissionHandler({db:q});
export const config={api:{bodyParser:false},maxDuration:15};
