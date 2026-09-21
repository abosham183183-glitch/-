// ==========================================
// إعدادات النظام
// ==========================================

const MAX_BOOKINGS_PER_DAY = 16;


// ==========================================
// المتغيرات
// ==========================================

let selectedTime = "";


// ==========================================
// تشغيل الموقع
// ==========================================

document.addEventListener("DOMContentLoaded", function () {

    setMinimumDate();

    loadBookings();

    setupTimeButtons();

    document
        .getElementById("appointmentDate")
        .addEventListener("change", loadBookings);

    document
        .getElementById("bookingForm")
        .addEventListener("submit", handleBooking);

});


// ==========================================
// منع اختيار تاريخ قديم
// ==========================================

function setMinimumDate() {

    const input =
        document.getElementById("appointmentDate");

    const now = new Date();

    const year =
        now.getFullYear();

    const month =
        String(now.getMonth() + 1).padStart(2, "0");

    const day =
        String(now.getDate()).padStart(2, "0");

    input.min =
        `${year}-${month}-${day}`;

}


// ==========================================
// أزرار الأوقات
// ==========================================

function setupTimeButtons() {

    const buttons =
        document.querySelectorAll(".time-slot");

    buttons.forEach(button => {

        button.addEventListener("click", function () {

            if (button.classList.contains("booked")) {
                return;
            }

            buttons.forEach(btn => {

                btn.classList.remove("selected");

            });

            button.classList.add("selected");

            selectedTime =
                button.dataset.time;

            document
                .getElementById("selectedTime")
                .value = selectedTime;

        });

    });

}


// ==========================================
// مفتاح حجوزات اليوم
// ==========================================

function getStorageKey() {

    const date =
        document.getElementById("appointmentDate").value;

    return "doctor_bookings_" + date;

}


// ==========================================
// قراءة الحجوزات
// ==========================================

function getBookings() {

    const key = getStorageKey();

    return JSON.parse(
        localStorage.getItem(key) || "[]"
    );

}


// ==========================================
// تحميل الحجوزات
// ==========================================

function loadBookings() {

    const date =
        document.getElementById("appointmentDate").value;

    if (!date) {

        resetTimeButtons();

        renderQueue([]);

        return;
    }

    const bookings =
        getBookings();

    const bookedTimes =
        bookings.map(item => item.time);


    document
        .querySelectorAll(".time-slot")
        .forEach(button => {

            const time =
                button.dataset.time;

            button.classList.remove(
                "booked",
                "selected"
            );

            button.disabled = false;

            if (bookedTimes.includes(time)) {

                button.classList.add("booked");

                button.disabled = true;

            }

        });


    selectedTime = "";

    document
        .getElementById("selectedTime")
        .value = "";


    renderQueue(bookings);

}


// ==========================================
// إعادة الأوقات
// ==========================================

function resetTimeButtons() {

    document
        .querySelectorAll(".time-slot")
        .forEach(button => {

            button.classList.remove(
                "booked",
                "selected"
            );

            button.disabled = false;

        });

}


// ==========================================
// إخفاء البيانات
// ==========================================

function maskName(name) {

    if (!name) return "";

    const parts =
        name.trim().split(" ");

    return parts
        .map(part => {

            if (part.length <= 2) {
                return part;
            }

            return (
                part.substring(0, 1)
                +
                "*".repeat(
                    Math.min(part.length - 1, 4)
                )
            );

        })
        .join(" ");

}


function maskPhone(phone) {

    if (!phone) return "";

    if (phone.length <= 6) {
        return "****";
    }

    return (
        phone.substring(0, 4)
        +
        "****"
        +
        phone.substring(phone.length - 3)
    );

}


// ==========================================
// عرض قائمة الأدوار
// ==========================================

function renderQueue(bookings) {

    const list =
        document.getElementById("queueList");

    list.innerHTML = "";


    if (!bookings.length) {

        list.innerHTML = `
            <div class="empty-queue">

                <i class="fa-solid fa-calendar-day"></i>

                <p>
                    لا توجد حجوزات ظاهرة حالياً
                </p>

            </div>
        `;

        return;
    }


    bookings.forEach((booking, index) => {

        const item =
            document.createElement("div");

        item.className = "queue-item";

        item.innerHTML = `

            <div class="queue-number">
                #${index + 1}
            </div>

            <div>

                <div class="queue-name">
                    ${escapeHTML(
                        maskName(booking.name)
                    )}
                </div>

                <small>
                    ${escapeHTML(
                        maskPhone(booking.phone)
                    )}
                </small>

            </div>

            <div class="queue-time">

                <i class="fa-solid fa-clock"></i>

                ${formatTime(booking.time)}

            </div>
        `;

        list.appendChild(item);

    });

}


// ==========================================
// الحجز
// ==========================================

function handleBooking(event) {

    event.preventDefault();


    const name =
        document
            .getElementById("patientName")
            .value.trim();

    const phone =
        document
            .getElementById("patientPhone")
            .value.trim();

    const address =
        document
            .getElementById("patientAddress")
            .value.trim();

    const date =
        document
            .getElementById("appointmentDate")
            .value;

    const symptoms =
        document
            .getElementById("patientSymptoms")
            .value.trim();


    if (!selectedTime) {

        alert(
            "يرجى اختيار وقت الموعد."
        );

        return;
    }


    let bookings =
        getBookings();


    // منع تجاوز العدد

    if (
        bookings.length >=
        MAX_BOOKINGS_PER_DAY
    ) {

        alert(
            "عذراً، اكتمل عدد الحجوزات لهذا اليوم."
        );

        return;
    }


    // منع حجز نفس الوقت

    const alreadyBooked =
        bookings.some(
            booking =>
                booking.time === selectedTime
        );


    if (alreadyBooked) {

        alert(
            "هذا الموعد تم حجزه للتو. اختر موعداً آخر."
        );

        loadBookings();

        return;
    }


    const queueNumber =
        bookings.length + 1;


    const booking = {

        name: name,

        phone: phone,

        address: address,

        date: date,

        time: selectedTime,

        symptoms: symptoms,

        queue: queueNumber,

        createdAt:
            new Date().toISOString()

    };


    bookings.push(booking);


    localStorage.setItem(
        getStorageKey(),
        JSON.stringify(bookings)
    );


    showTicket(booking);


    loadBookings();

}


// ==========================================
// إظهار التذكرة
// ==========================================

function showTicket(booking) {

    document
        .getElementById("ticketQueue")
        .textContent =
        "#" +
        String(booking.queue)
            .padStart(2, "0");


    document
        .getElementById("ticketName")
        .textContent =
        booking.name;


    document
        .getElementById("ticketPhone")
        .textContent =
        booking.phone;


    document
        .getElementById("ticketDate")
        .textContent =
        formatDate(booking.date);


    document
        .getElementById("ticketTime")
        .textContent =
        formatTime(booking.time);


    document
        .getElementById("ticketSection")
        .style.display =
        "block";


    document
        .getElementById("bookingSection")
        .style.display =
        "none";


    document
        .getElementById("ticketSection")
        .scrollIntoView({
            behavior: "smooth"
        });


    // تجهيز إرسال البريد لاحقاً

    prepareDoctorNotification(booking);

}


// ==========================================
// تجهيز بيانات الدكتور
// ==========================================

function prepareDoctorNotification(booking) {

    const doctorEmail =
        "hmudealali750@gmail.com";


    const subject =
        `حجز جديد - الدور #${booking.queue}`;


    const body = `
حجز موعد طبي جديد

الدكتور:
السيد علي محمد الخطيب

رقم الدور:
#${booking.queue}

اسم المريض:
${booking.name}

رقم الهاتف:
${booking.phone}

التاريخ:
${formatDate(booking.date)}

الموعد:
${formatTime(booking.time)}

العنوان:
${booking.address}

الشكوى:
${booking.symptoms}
`;


    /*
      ملاحظة:

      لن نستخدم mailto لإرسال البريد تلقائياً.

      في المرحلة القادمة سنربط هذه البيانات
      بخدمة إرسال بريد وقاعدة بيانات حقيقية.

      حتى يصل الحجز للدكتور تلقائياً
      بدون أن يفتح المريض Gmail.
    */

    console.log(
        "Doctor Email:",
        doctorEmail
    );

    console.log(
        body
    );

}


// ==========================================
// طباعة التذكرة
// ==========================================

function printTicket() {

    window.print();

}


// ==========================================
// حجز جديد
// ==========================================

function newBooking() {

    document
        .getElementById("bookingForm")
        .reset();


    selectedTime = "";


    document
        .getElementById("ticketSection")
        .style.display =
        "none";


    document
        .getElementById("bookingSection")
        .style.display =
        "block";


    loadBookings();


    window.scrollTo({

        top: 0,

        behavior: "smooth"

    });

}


// ==========================================
// تنسيق التاريخ
// ==========================================

function formatDate(dateString) {

    const date =
        new Date(
            dateString + "T00:00:00"
        );

    return date.toLocaleDateString(
        "ar-SY",
        {
            year: "numeric",
            month: "long",
            day: "numeric"
        }
    );

}


// ==========================================
// تنسيق الوقت
// ==========================================

function formatTime(time) {

    const parts =
        time.split(":");

    let hour =
        Number(parts[0]);

    const minute =
        parts[1];

    const period =
        hour >= 12
            ? "مساءً"
            : "صباحاً";


    if (hour > 12) {
        hour -= 12;
    }

    if (hour === 0) {
        hour = 12;
    }


    return `${hour}:${minute} ${period}`;

}


// ==========================================
// حماية عرض النصوص
// ==========================================

function escapeHTML(text) {

    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}
