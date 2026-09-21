const TIMES = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30"
];

const STORAGE_KEY = "doctor_bookings";

const form = document.getElementById("bookingForm");
const nameInput = document.getElementById("patientName");
const phoneInput = document.getElementById("phone");
const addressInput = document.getElementById("address");
const dateInput = document.getElementById("bookingDate");
const timeInput = document.getElementById("appointmentTime");
const symptomsInput = document.getElementById("symptoms");

const successBox = document.getElementById("successBox");
const successText = document.getElementById("successText");

const ticketSection = document.getElementById("ticketSection");
const ticketNumber = document.getElementById("ticketNumber");
const ticketName = document.getElementById("ticketName");
const ticketPhone = document.getElementById("ticketPhone");
const ticketDate = document.getElementById("ticketDate");
const ticketTime = document.getElementById("ticketTime");

const today = new Date();
const todayString =
  today.getFullYear() +
  "-" +
  String(today.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(today.getDate()).padStart(2, "0");

dateInput.min = todayString;


/* البطاقات التفاعلية */

document.querySelectorAll(".interactive-card").forEach(card => {

  card.addEventListener("click", function(event) {

    if (event.target.tagName === "BUTTON") {
      event.stopPropagation();
    }

    const targetId = card.dataset.target;
    openPanel(targetId);
  });

});


function openPanel(id) {

  document.querySelectorAll(".panel").forEach(panel => {
    panel.classList.remove("active");
  });

  const target = document.getElementById(id);

  if (!target) return;

  target.classList.add("active");

  setTimeout(() => {
    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 50);
}


/* أوقات المواعيد */

function createTimes() {

  timeInput.innerHTML =
    '<option value="">اختر الساعة</option>';

  TIMES.forEach(time => {

    const option = document.createElement("option");

    option.value = time;
    option.textContent = time;

    timeInput.appendChild(option);
  });

}

createTimes();


/* قاعدة البيانات المحلية */

function getBookings() {

  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEY)
    ) || [];
  } catch {
    return [];
  }

}


function saveBookings(bookings) {

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(bookings)
  );

}


/* تحديث الساعات المتاحة */

dateInput.addEventListener("change", updateAvailableTimes);

function updateAvailableTimes() {

  const selectedDate = dateInput.value;

  createTimes();

  if (!selectedDate) return;

  const bookings = getBookings();

  const bookedTimes = bookings
    .filter(item => item.date === selectedDate)
    .map(item => item.time);

  Array.from(timeInput.options).forEach(option => {

    if (bookedTimes.includes(option.value)) {
      option.disabled = true;
      option.textContent = option.value + " - محجوز";
    }

  });

}


/* تنظيف الأخطاء */

function clearErrors() {

  document.querySelectorAll(".error").forEach(error => {
    error.textContent = "";
  });

  document.querySelectorAll("input, select").forEach(input => {
    input.classList.remove("input-error");
  });

}


function setError(input, errorElement, message) {

  input.classList.add("input-error");
  errorElement.textContent = message;

}


/* التحقق من الاسم */

function validName(name) {

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return parts.length >= 3;

}


/* التحقق من الهاتف */

function validPhone(phone) {

  return /^05[0-9]{9}$/.test(phone);

}


/* إرسال الحجز */

form.addEventListener("submit", function(event) {

  event.preventDefault();

  clearErrors();

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const address = addressInput.value.trim();
  const date = dateInput.value;
  const time = timeInput.value;
  const symptoms = symptomsInput.value.trim();

  let valid = true;


  if (!validName(name)) {

    setError(
      nameInput,
      document.getElementById("nameError"),
      "اكتب الاسم الثلاثي بشكل صحيح."
    );

    valid = false;
  }


  if (!validPhone(phone)) {

    setError(
      phoneInput,
      document.getElementById("phoneError"),
      "أدخل رقم هاتف صحيح مثل 05317442218."
    );

    valid = false;
  }


  if (!address) {

    setError(
      addressInput,
      document.getElementById("addressError"),
      "أدخل العنوان."
    );

    valid = false;
  }


  if (!date) {

    setError(
      dateInput,
      document.getElementById("dateError"),
      "اختر تاريخ الموعد."
    );

    valid = false;
  }


  if (!time) {

    setError(
      timeInput,
      document.getElementById("timeError"),
      "اختر ساعة الموعد."
    );

    valid = false;
  }


  if (!valid) return;


  const bookings = getBookings();


  /* منع حجز الهاتف نفسه مرتين */

  const samePhone = bookings.some(
    booking => booking.phone === phone
  );

  if (samePhone) {

    setError(
      phoneInput,
      document.getElementById("phoneError"),
      "هذا الرقم لديه موعد مسجل مسبقاً."
    );

    return;
  }


  /* منع الاسم نفسه من الحجز مرتين */

  const normalizedName = name
    .replace(/\s+/g, " ")
    .toLowerCase();

  const sameName = bookings.some(
    booking =>
      booking.name
        .replace(/\s+/g, " ")
        .toLowerCase() === normalizedName
  );

  if (sameName) {

    setError(
      nameInput,
      document.getElementById("nameError"),
      "هذا الاسم لديه موعد مسجل مسبقاً."
    );

    return;
  }


  /* منع حجز نفس الساعة */

  const sameTime = bookings.some(
    booking =>
      booking.date === date &&
      booking.time === time
  );

  if (sameTime) {

    setError(
      timeInput,
      document.getElementById("timeError"),
      "هذه الساعة محجوزة، اختر ساعة أخرى."
    );

    updateAvailableTimes();

    return;
  }


  const visitorNumber = bookings.length + 1;


  const booking = {
    id: Date.now(),
    visitorNumber,
    name,
    phone,
    address,
    date,
    time,
    symptoms
  };


  bookings.push(booking);

  saveBookings(bookings);


  showSuccess(booking);

});


/* إظهار نجاح الحجز */

function showSuccess(booking) {

  successText.textContent =
    "تم تسجيل موعدك بتاريخ " +
    formatDate(booking.date) +
    " الساعة " +
    booking.time +
    ".";

  successBox.classList.add("show");


  ticketNumber.textContent =
    String(booking.visitorNumber).padStart(2, "0");

  ticketName.textContent = booking.name;
  ticketPhone.textContent = booking.phone;
  ticketDate.textContent = formatDate(booking.date);
  ticketTime.textContent = booking.time;

  ticketSection.classList.add("show");


  form.reset();

  dateInput.min = todayString;

  createTimes();

  ticketSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

}


/* تنسيق التاريخ */

function formatDate(value) {

  const parts = value.split("-");

  if (parts.length !== 3) {
    return value;
  }

  return parts[2] + "/" + parts[1] + "/" + parts[0];

}


/* طباعة البطاقة */

document
  .getElementById("printTicket")
  .addEventListener("click", function() {

    window.print();

  });


/* حجز جديد */

document
  .getElementById("newBooking")
  .addEventListener("click", function() {

    successBox.classList.remove("show");
    ticketSection.classList.remove("show");

    openPanel("booking");

    nameInput.focus();

  });
