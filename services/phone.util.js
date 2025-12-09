// services/phone.util.js
function normalizePhone(raw) {
  if (!raw) return null;

  // keep digits only
  let digits = String(raw).replace(/\D/g, "");

  // if 10 digits, assume Indian mobile → prepend country code
  if (digits.length === 10) {
    digits = "91" + digits;
  }

  // if it already starts with 91 and is 12 digits, leave as is
  // you can add more rules later for other countries
  return digits;
}

module.exports = { normalizePhone };
