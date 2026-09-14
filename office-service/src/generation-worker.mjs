import {parentPort,workerData} from 'node:worker_threads';
import {generateArchive} from './templates.mjs';
try {const {bytes,files}=generateArchive({...workerData,includeManifest:true});parentPort.postMessage({bytes,files},[bytes.buffer]);}
catch(error){parentPort.postMessage({error:error.status ? error.message : 'Не удалось обработать макет. Проверьте его структуру и поля.'});}
