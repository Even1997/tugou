const base=require('./cloud-package.cjs');
module.exports={...base,directories:{output:require('./qa-paths.cjs').path("installer-package")}};
