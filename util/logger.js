/* eslint-disable no-console */
module.exports = {
  /** logs won't be displayed on NODE_ENV production */
  info(message, ...args) {
    console.log('INFO', message, args);
  },
  /** Method to log errors */
  error(message, ...args) {
    console.error('\x1b[31mERROR\x1b[0m', message, args);
  },
  /** These logs will always be logged */
  always(message, ...args) {
    console.log('ALAWYS', message, args);
  },
};
