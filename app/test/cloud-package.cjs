const base=require('../electron-builder.cjs');
module.exports={...base,directories:{output:'test-results/cloud-package'},files:[...base.files.filter(f=>f!=='dist/**/*'),{from:'test-results/local-tools-build',to:'dist',filter:['**/*']}]};
