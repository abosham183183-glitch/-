// ========================================
// إعدادات الموقع
// ========================================

const MAX_BOOKINGS_PER_DAY = 16;


// ========================================
// عند تحميل الصفحة
// ========================================

document.addEventListener("DOMContentLoaded", function () {

    setMinimumDate();

    updateClinicStatus();

    document
        .getElementById("bookingForm")
        .addEventListener("submit", handleBooking);

});


// ========================================
// منع اختيار تاريخ قديم
// ========================================

function setMinimumDate() {

    const dateInput = document.getElementById("appointmentDate");

    const today = new Date();

    const year = today.getFullYear();

    const month = String(today.getMonth() + 1).padStart(2, "0");

    const day = String(today.getDate()).padStart(2, "0");

    dateInput.min = `${year}-${month}-${day}`;

}


// ========================================
// إنشاء رقم حجز
// ========================================

function generateBookingNumber() {

    const random = Math.floor(1000 + Math.random() * 9000);

    return "#" + random;

}


// ========================================
// تحديث حالة العيادة
// ========================================

function updateClinicStatus() {

    const status = document.getElementById("clinicStatus");

    const today = new Date();

    const day = today.getDay();

    // الجمعة
    if (day === 5) {

        status.className = "status status-closed";

        status.innerHTML = `
            <i class="fa-solid fa-door-closed"></i>
            العيادة مغلقة اليوم
        `;

        return;
    }

    status.className = "status status-open";

    status.innerHTML = `
        <i class="fa-solid fa-circle-check"></i>
        الحجز الإلكتروني متاح
    `;

}


// ========================================
// معالجة الحجز
// ========================================

function handleBooking(event) {

    event.preventDefault();


    const name =
        document.getElementById("patientName").value.trim();

    const phone =
        document.getElementById("patientPhone").value.trim();

    const address =
        document.getElementById("patientAddress").value.trim();

    const date =
        document.getElementById("appointmentDate").value;

    const time =
        document.getElementById("appointmentTime").value;

    const symptoms =
        document.getElementById("patientSymptoms").value.trim();


    if (!name || !phone || !address || !date || !time || !symptoms) {

        alert("يرجى تعبئة جميع المعلومات.");

        return;

    }


    const bookingNumber = generateBookingNumber();


    // عرض التذكرة للمريض

    document.getElementById("ticketNumber").textContent =
        bookingNumber;

    document.getElementById("ticketName").textContent =
        name;

    document.getElementById("ticketPhone").textContent =
        phone;

    document.getElementById("ticketAddress").textContent =
        address;

    document.getElementById("ticketDate").textContent =
        formatDate(date);

    document.getElementById("ticketTime").textContent =
        formatTime(time);


    // إخفاء نموذج الحجز

    document.getElementById("bookingSection").style.display =
        "none";


    // إظهار التذكرة

    document.getElementById("ticketSection").style.display =
        "block";


    // الانتقال للتذكرة

    document.getElementById("ticketSection")
        .scrollIntoView({
            behavior: "smooth"
        });


    /*
       في المرحلة القادمة سنضيف هنا:

       1. إرسال بيانات الحجز إلى قاعدة البيانات
       2. إرسال الحجز إلى Gmail الدكتور
       3. منع حجز الموعد المحجوز مسبقاً
       4. لوحة تحكم الدكتور
    */

}


// ========================================
// تنسيق التاريخ
// ========================================

function formatDate(dateString) {

    const date = new Date(dateString + "T00:00:00");

    return date.toLocaleDateString("ar-SY", {

        year: "numeric",
        month: "long",
        day: "numeric"

    });

}


// ========================================
// تنسيق الوقت
// ========================================

function formatTime(timeString) {

    const [hour, minute] =
        timeString.split(":");

    let hourNumber = Number(hour);

    const period =
        hourNumber >= 12 ? "مساءً" : "صباحاً";

    if (hourNumber > 12) {
        hourNumber -= 12;
    }

    if (hourNumber === 0) {
        hourNumber = 12;
    }

    return `${hourNumber}:${minute} ${period}`;

}


// ========================================
// طباعة الحجز
// ========================================

function printTicket() {

    window.print();

}


// ========================================
// حجز جديد
// ========================================

function newBooking() {

    document.getElementById("bookingForm").reset();

    document.getElementById("ticketSection").style.display =
        "none";

    document.getElementById("bookingSection").style.display =
        "block";

    window.scrollTo({

        top: 0,

        behavior: "smooth"

    });

}
