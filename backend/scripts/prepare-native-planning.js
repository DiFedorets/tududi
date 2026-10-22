// Run explicitly on a backup or a stopped deployment before enabling this version.
const { sequelize } = require('../models');
require('../extensions/one/nativePlanning')
    .reconcile()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => sequelize.close());
