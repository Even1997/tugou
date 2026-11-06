const {parentPort,workerData}=require('node:worker_threads');
const {decode,encode}=require('./psd-codec.cjs');
Promise.resolve().then(()=>workerData.action==='decode'?decode(workerData.bytes,workerData.merged):encode(workerData.input)).then(value=>parentPort.postMessage({value}),error=>parentPort.postMessage({error:error.message}));
