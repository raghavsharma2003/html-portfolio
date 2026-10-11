import {requireUser} from './_auth.js';
import {createPrivateVoiceProxy} from './_private-voice-proxy.js';
export const config={maxDuration:30};
export default createPrivateVoiceProxy({requireUser});
