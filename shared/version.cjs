"use strict";

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayVersion(date = new Date()) {
  return "v" + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate())
    + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

module.exports = { todayVersion };
