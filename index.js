"use strict";


/* =========================================
   إعدادات الموقع
========================================= */

const MAX_BOOKINGS_PER_DAY = 16;

const DOCTOR_PHONE = "05317442218";

const STORAGE_KEY = "doctor_bookings_v2";


/* =========================================
   عناصر الصفحة
========================================= */

const bookingForm =
    document.getElementById("bookingForm");

const patientNameInput =
    document.getElementById("patientName");

const phoneInput =
    document.getElementById("phone");

const addressInput =
    document.getElementById("address");

const bookingDateInput =
    document.getElementById("bookingDate");

const symptomsInput =
    document.getElementById("symptoms");

const timeSlotsContainer =
    document.getElementById("timeSlots");

const selectedTimeInput =
    document.getElementById("selectedTime");

const queueList =
    document.getElementById("queueList");

const ticketSection =
    document.getElementById("ticketSection");

const successBox =
    document.getElementById("successBox");

const submitBooking =
    document.getElementById("submitBooking");


/* =========================================
   أوقات المواعيد
========================================= */

const appointmentTimes = [
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


/* =========================================
   تشغيل الموقع
========================================= */

document.addEventListener("DOMContentLoaded", function () {

    setMinimumDate();

    renderTimeSlots();

    renderQueue();

});


/* =========================================
   منع اختيار تاريخ قديم
========================================= */

function setMinimumDate() {

    const today = new Date();

    const year =
        today.getFullYear();

    const month =
        String(today.getMonth() + 1)
        .padStart(2, "0");

    const day =
        String(today.getDate())
        .padStart(2, "0");

    const todayString =
        `${year}-${month}-${day}`;

    bookingDateInput.min = todayString;

    if (!bookingDateInput.value) {
        bookingDateInput.value = todayString;
    }

}


/* =========================================
   إنشاء أوقات الحجز
========================================= */

function renderTimeSlots() {

    timeSlotsContainer.innerHTML = "";

    const selectedDate =
        bookingDateInput.value;

    const bookings =
        getBookings();

    const dateBookings =
        bookings.filter(
            booking =>
                booking.date === selectedDate
        );


    appointmentTimes.forEach(function (time) {

        const button =
            document.createElement("button");

        button.type = "button";

        button.className = "time-slot";

        button.textContent =
            formatTime(time);


        const isBooked =
            dateBookings.some(
                booking =>
                    booking.time === time
            );


        if (isBooked) {

            button.classList.add("disabled");

            button.disabled = true;

            button.title =
                "هذا الموعد محجوز";

        }


        button.addEventListener(
            "click",
            function () {

                if (button.disabled) {
                    return;
                }

                document
                    .querySelectorAll(".time-slot")
                    .forEach(
                        item =>
                            item.classList.remove("selected")
                    );

                button.classList.add("selected");

                selectedTimeInput.value =
                    time;

            }
        );


        timeSlotsContainer.appendChild(button);

    });

}


bookingDateInput.addEventListener(
    "change",
    function () {

        selectedTimeInput.value = "";

        renderTimeSlots();

    }
);


/* =========================================
   جلب الحجوزات
========================================= */

function getBookings() {

    try {

        const data =
            localStorage.getItem(STORAGE_KEY);

        if (!data) {
            return [];
        }

        const parsed =
            JSON.parse(data);

        return Array.isArray(parsed)
            ? parsed
            : [];

    } catch (error) {

        console.error(error);

        return [];

    }

}


/* =========================================
   حفظ الحجوزات
========================================= */

function saveBookings(bookings) {

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(bookings)
    );

}


/* =========================================
   تنظيف الاسم
========================================= */

function cleanName(name) {

    return name
        .trim()
        .replace(/\s+/g, " ");

}


/* =========================================
   التحقق من الاسم الثلاثي
========================================= */

function isValidFullName(name) {

    const parts =
        cleanName(name).split(" ");

    return parts.length >= 3;

}


/* =========================================
   التحقق من الهاتف
========================================= */

function isValidPhone(phone) {

    const cleanPhone =
        phone.replace(/\s+/g, "");

    /*
       الصيغة الحالية:
       رقم يبدأ بـ 05
       وبعده 9 أرقام
       مثال:
       05317442218
    */

    return /^05\d{9}$/.test(cleanPhone);

}


/* =========================================
   إخفاء الاسم
========================================= */

function maskName(name) {

    const parts =
        cleanName(name).split(" ");

    if (parts.length === 0) {
        return "***";
    }

    const firstName =
        parts[0];

    const masked =
        firstName.length > 1
            ? firstName.substring(0, 2) + "***"
            : firstName + "***";

    return masked;

}


/* =========================================
   إخفاء الهاتف
========================================= */

function maskPhone(phone) {

    if (phone.length < 6) {
        return "***";
    }

    return (
        phone.substring(0, 3) +
        "*****" +
        phone.substring(phone.length - 2)
    );

}


/* =========================================
   معالجة الحجز
========================================= */

bookingForm.addEventListener(
    "submit",
    function (event) {

        event.preventDefault();


        const name =
            cleanName(
                patientNameInput.value
            );


        const phone =
            phoneInput.value
                .replace(/\s+/g, "")
                .trim();


        const address =
            addressInput.value.trim();


        const date =
            bookingDateInput.value;


        const time =
            selectedTimeInput.value;


        const symptoms =
            symptomsInput.value.trim();


        /* -------------------------
           التحقق من الاسم
        ------------------------- */

        if (!isValidFullName(name)) {

            alert(
                "يرجى كتابة الاسم الثلاثي الكامل، مثال: أحمد محمد علي"
            );

            patientNameInput.focus();

            return;

        }


        /* -------------------------
           التحقق من الهاتف
        ------------------------- */

        if (!isValidPhone(phone)) {

            alert(
                "يرجى إدخال رقم هاتف صحيح مثل: 05317442218"
            );

            phoneInput.focus();

            return;

        }


        /* -------------------------
           التحقق من العنوان
        ------------------------- */

        if (!address) {

            alert(
                "يرجى كتابة العنوان."
            );

            addressInput.focus();

            return;

        }


        /* -------------------------
           التحقق من التاريخ
        ------------------------- */

        if (!date) {

            alert(
                "يرجى اختيار تاريخ الموعد."
            );

            return;

        }


        /* -------------------------
           التحقق من الوقت
        ------------------------- */

        if (!time) {

            alert(
                "يرجى اختيار وقت الموعد."
            );

            return;

        }


        let bookings =
            getBookings();


        /* -------------------------
           حجوزات نفس اليوم
        ------------------------- */

        const dateBookings =
            bookings.filter(
                booking =>
                    booking.date === date
            );


        /* -------------------------
           الحد الأقصى
        ------------------------- */

        if (
            dateBookings.length >=
            MAX_BOOKINGS_PER_DAY
        ) {

            alert(
                "عذرًا، اكتمل عدد المواعيد لهذا اليوم."
            );

            return;

        }


        /* -------------------------
           منع حجز الوقت
        ------------------------- */

        const timeAlreadyBooked =
            dateBookings.some(
                booking =>
                    booking.time === time
            );


        if (timeAlreadyBooked) {

            alert(
                "هذا الوقت محجوز مسبقًا، يرجى اختيار وقت آخر."
            );

            renderTimeSlots();

            return;

        }


        /* -------------------------
           منع تكرار الرقم
        ------------------------- */

        const phoneAlreadyUsed =
            bookings.some(
                booking =>
                    booking.phone === phone
            );


        if (phoneAlreadyUsed) {

            alert(
                "هذا الرقم لديه موعد مسجل مسبقًا، ولا يمكن حجز موعد ثانٍ بنفس الرقم."
            );

            return;

        }


        /* -------------------------
           منع تكرار الاسم
        ------------------------- */

        const normalizedName =
            name.toLowerCase();


        const nameAlreadyUsed =
            bookings.some(
                booking =>
                    booking.name
                        .toLowerCase() ===
                    normalizedName
            );


        if (nameAlreadyUsed) {

            alert(
                "هذا الاسم لديه موعد مسجل مسبقًا، ولا يمكن حجز موعدين بنفس الاسم."
            );

            return;

        }


        /* -------------------------
           رقم المراجع
        ------------------------- */

        const visitorNumber =
            dateBookings.length + 1;


        /* -------------------------
           إنشاء الحجز
        ------------------------- */

        const booking = {

            id:
                Date.now().toString(),

            visitorNumber:

                visitorNumber,

            name:
                name,

            phone:
                phone,

            address:
                address,

            date:
                date,

            time:
                time,

            symptoms:
                symptoms,

            createdAt:
                new Date().toISOString()

        };


        bookings.push(booking);

        saveBookings(bookings);


        /* -------------------------
           رسالة نجاح
        ------------------------- */

        successBox.classList.remove(
            "hidden"
        );


        /* -------------------------
           عرض التذكرة
        ------------------------- */

        showTicket(booking);


        /* -------------------------
           تحديث القائمة
        ------------------------- */

        renderQueue();

        renderTimeSlots();


        /* -------------------------
           إخفاء نموذج الحجز
        ------------------------- */

        bookingForm.reset();

        selectedTimeInput.value = "";


        /* -------------------------
           إعادة التاريخ
        ------------------------- */

        setMinimumDate();


        /* -------------------------
           تحريك الصفحة للنجاح
        ------------------------- */

        successBox.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });


        /*
           لاحقًا سنضع هنا إرسال
           الحجز إلى Firebase
           وإرسال إشعار Gmail للطبيب.
        */

    }
);


/* =========================================
   عرض التذكرة
========================================= */

function showTicket(booking) {

    ticketSection.classList.remove(
        "hidden"
    );


    document.getElementById(
        "ticketNumber"
    ).textContent =
        String(
            booking.visitorNumber
        ).padStart(2, "0");


    document.getElementById(
        "ticketName"
    ).textContent =
        booking.name;


    document.getElementById(
        "ticketPhone"
    ).textContent =
        booking.phone;


    document.getElementById(
        "ticketDate"
    ).textContent =
        formatDate(booking.date);


    document.getElementById(
        "ticketTime"
    ).textContent =
        formatTime(booking.time);


    ticketSection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

}


/* =========================================
   عرض قائمة المراجعين
========================================= */

function renderQueue() {

    const selectedDate =
        bookingDateInput.value;

    const bookings =
        getBookings()
            .filter(
                booking =>
                    booking.date === selectedDate
            )
            .sort(
                (a, b) =>
                    a.time.localeCompare(b.time)
            );


    if (bookings.length === 0) {

        queueList.innerHTML = `
            <div class="queue-empty">
                لا توجد مواعيد مسجلة لهذا اليوم.
            </div>
        `;

        return;

    }


    queueList.innerHTML = "";


    bookings.forEach(function (booking) {

        const item =
            document.createElement("div");

        item.className =
            "queue-item";


        item.innerHTML = `

            <div class="queue-number">
                ${String(booking.visitorNumber).padStart(2, "0")}
            </div>

            <div class="queue-info">

                <strong>
                    مراجع رقم ${String(booking.visitorNumber).padStart(2, "0")}
                </strong>

                <span>
                    ${maskName(booking.name)}
                    ·
                    ${formatTime(booking.time)}
                </span>

            </div>

        `;


        queueList.appendChild(item);

    });

}


/* =========================================
   عند تغيير التاريخ
========================================= */

bookingDateInput.addEventListener(
    "change",
    function () {

        renderQueue();

    }
);


/* =========================================
   طباعة التذكرة
========================================= */

document
    .getElementById("printTicket")
    .addEventListener(
        "click",
        function () {

            window.print();

        }
    );


/* =========================================
   حجز جديد
========================================= */

document
    .getElementById("newBooking")
    .addEventListener(
        "click",
        function () {

            ticketSection.classList.add(
                "hidden"
            );

            successBox.classList.add(
                "hidden"
            );

            bookingForm.reset();

            selectedTimeInput.value = "";

            setMinimumDate();

            renderTimeSlots();

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

        }
    );


/* =========================================
   تنسيق التاريخ
========================================= */

function formatDate(dateString) {

    if (!dateString) {
        return "--";
    }

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


/* =========================================
   تنسيق الوقت
========================================= */

function formatTime(time) {

    if (!time) {
        return "--";
    }


    const parts =
        time.split(":");


    let hour =
        Number(parts[0]);


    const minute =
        parts[1];


    const period =
        hour >= 12
            ? "مساءً"
            : "صباحًا";


    if (hour > 12) {
        hour -= 12;
    }


    if (hour === 0) {
        hour = 12;
    }


    return `${hour}:${minute} ${period}`;

}
