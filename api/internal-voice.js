import {requireUser} from './_auth.js';
import {createInternalVoiceProxy} from './_internal-voice-proxy.js';
export const config={maxDuration:30};
export default createInternalVoiceProxy({requireUser});
