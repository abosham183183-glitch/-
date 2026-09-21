"use strict";


/* =========================
   الإعدادات
========================= */

const STORAGE_KEY = "doctor_bookings_v3";

const MAX_BOOKINGS_PER_DAY = 16;


/*
   أوقات الحجز
   من الساعة 09:00
   حتى 14:30
*/

const APPOINTMENT_TIMES = [
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


/* =========================
   العناصر
========================= */

const form =
    document.getElementById("bookingForm");

const nameInput =
    document.getElementById("patientName");

const phoneInput =
    document.getElementById("phone");

const addressInput =
    document.getElementById("address");

const dateInput =
    document.getElementById("bookingDate");

const timeSelect =
    document.getElementById("appointmentTime");

const symptomsInput =
    document.getElementById("symptoms");

const successBox =
    document.getElementById("successBox");

const ticketSection =
    document.getElementById("ticketSection");

const queueList =
    document.getElementById("queueList");


/* =========================
   رسائل الخطأ
========================= */

const nameError =
    document.getElementById("nameError");

const phoneError =
    document.getElementById("phoneError");

const addressError =
    document.getElementById("addressError");

const dateError =
    document.getElementById("dateError");

const timeError =
    document.getElementById("timeError");


/* =========================
   بدء الموقع
========================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        setMinimumDate();

        createTimeOptions();

        renderQueue();

    }
);


/* =========================
   التاريخ الأدنى
========================= */

function setMinimumDate() {

    const today =
        new Date();

    const year =
        today.getFullYear();

    const month =
        String(
            today.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            today.getDate()
        ).padStart(2, "0");

    const todayString =
        `${year}-${month}-${day}`;

    dateInput.min =
        todayString;

    if (!dateInput.value) {

        dateInput.value =
            todayString;

    }

}


/* =========================
   إنشاء قائمة الساعات
========================= */

function createTimeOptions() {

    timeSelect.innerHTML = "";

    const firstOption =
        document.createElement("option");

    firstOption.value = "";

    firstOption.textContent =
        "اختر ساعة الحجز";

    timeSelect.appendChild(
        firstOption
    );


    APPOINTMENT_TIMES.forEach(
        function (time) {

            const option =
                document.createElement("option");

            option.value =
                time;

            option.textContent =
                formatTime(time);

            timeSelect.appendChild(
                option
            );

        }
    );


    updateAvailableTimes();

}


/* =========================
   تحديث الساعات المحجوزة
========================= */

function updateAvailableTimes() {

    const selectedDate =
        dateInput.value;

    const bookings =
        getBookings();

    const bookedTimes =
        bookings
            .filter(
                booking =>
                    booking.date === selectedDate
            )
            .map(
                booking =>
                    booking.time
            );


    Array.from(
        timeSelect.options
    ).forEach(
        function (option, index) {

            if (index === 0) {
                return;
            }

            const isBooked =
                bookedTimes.includes(
                    option.value
                );

            option.disabled =
                isBooked;

            if (isBooked) {

                option.textContent =
                    formatTime(option.value)
                    + " - محجوز";

            } else {

                option.textContent =
                    formatTime(option.value);

            }

        }
    );

}


/* =========================
   عند تغيير التاريخ
========================= */

dateInput.addEventListener(
    "change",
    function () {

        clearFieldError(
            dateInput,
            dateError
        );

        timeSelect.value = "";

        updateAvailableTimes();

        renderQueue();

    }
);


/* =========================
   جلب الحجوزات
========================= */

function getBookings() {

    try {

        const data =
            localStorage.getItem(
                STORAGE_KEY
            );

        if (!data) {
            return [];
        }

        const bookings =
            JSON.parse(data);

        return Array.isArray(bookings)
            ? bookings
            : [];

    } catch (error) {

        console.error(
            "خطأ في قراءة الحجوزات:",
            error
        );

        return [];

    }

}


/* =========================
   حفظ الحجوزات
========================= */

function saveBookings(bookings) {

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(bookings)
    );

}


/* =========================
   تنظيف الاسم
========================= */

function normalizeName(name) {

    return name
        .trim()
        .replace(/\s+/g, " ");

}


/* =========================
   الاسم الثلاثي
========================= */

function validName(name) {

    const clean =
        normalizeName(name);

    const words =
        clean.split(" ");

    return words.length >= 3;

}


/* =========================
   الهاتف
========================= */

function validPhone(phone) {

    const clean =
        phone
            .replace(/\s/g, "")
            .trim();

    return /^05\d{9}$/.test(clean);

}


/* =========================
   إظهار الخطأ
========================= */

function showError(
    input,
    errorElement,
    message
) {

    input.classList.add(
        "input-error"
    );

    errorElement.textContent =
        message;

}


/* =========================
   إزالة الخطأ
========================= */

function clearFieldError(
    input,
    errorElement
) {

    input.classList.remove(
        "input-error"
    );

    errorElement.textContent =
        "";

}


/* =========================
   التحقق من النموذج
========================= */

function validateForm() {

    let valid = true;


    /* الاسم */

    const name =
        normalizeName(
            nameInput.value
        );

    if (!name) {

        showError(
            nameInput,
            nameError,
            "يرجى كتابة الاسم الثلاثي."
        );

        valid = false;

    } else if (!validName(name)) {

        showError(
            nameInput,
            nameError,
            "يجب كتابة الاسم الثلاثي، مثال: أحمد محمد علي."
        );

        valid = false;

    } else {

        clearFieldError(
            nameInput,
            nameError
        );

    }


    /* الهاتف */

    const phone =
        phoneInput.value
            .replace(/\s/g, "")
            .trim();

    if (!phone) {

        showError(
            phoneInput,
            phoneError,
            "يرجى كتابة رقم الهاتف."
        );

        valid = false;

    } else if (!validPhone(phone)) {

        showError(
            phoneInput,
            phoneError,
            "رقم الهاتف غير صحيح. مثال: 05317442218"
        );

        valid = false;

    } else {

        clearFieldError(
            phoneInput,
            phoneError
        );

    }


    /* العنوان */

    if (
        !addressInput.value.trim()
    ) {

        showError(
            addressInput,
            addressError,
            "يرجى كتابة العنوان."
        );

        valid = false;

    } else {

        clearFieldError(
            addressInput,
            addressError
        );

    }


    /* التاريخ */

    if (!dateInput.value) {

        showError(
            dateInput,
            dateError,
            "يرجى اختيار تاريخ الموعد."
        );

        valid = false;

    } else {

        clearFieldError(
            dateInput,
            dateError
        );

    }


    /* الساعة */

    if (!timeSelect.value) {

        showError(
            timeSelect,
            timeError,
            "يرجى اختيار ساعة الحجز."
        );

        valid = false;

    } else {

        clearFieldError(
            timeSelect,
            timeError
        );

    }


    return valid;

}


/* =========================
   إرسال الحجز
========================= */

form.addEventListener(
    "submit",
    function (event) {

        event.preventDefault();


        /* التحقق */

        if (!validateForm()) {

            const firstError =
                document.querySelector(
                    ".input-error"
                );

            if (firstError) {
                firstError.focus();
            }

            return;

        }


        const name =
            normalizeName(
                nameInput.value
            );


        const phone =
            phoneInput.value
                .replace(/\s/g, "")
                .trim();


        const address =
            addressInput.value.trim();


        const date =
            dateInput.value;


        const time =
            timeSelect.value;


        const symptoms =
            symptomsInput.value.trim();


        let bookings =
            getBookings();


        /* حجوزات اليوم */

        const todayBookings =
            bookings.filter(
                booking =>
                    booking.date === date
            );


        /* الحد الأقصى */

        if (
            todayBookings.length >=
            MAX_BOOKINGS_PER_DAY
        ) {

            showError(
                dateInput,
                dateError,
                "اكتملت مواعيد هذا اليوم، يرجى اختيار يوم آخر."
            );

            return;

        }


        /* التأكد من الوقت */

        const timeExists =
            bookings.some(
                booking =>
                    booking.date === date &&
                    booking.time === time
            );


        if (timeExists) {

            showError(
                timeSelect,
                timeError,
                "هذه الساعة محجوزة مسبقًا، يرجى اختيار ساعة أخرى."
            );

            updateAvailableTimes();

            return;

        }


        /* منع نفس الرقم */

        const phoneExists =
            bookings.some(
                booking =>
                    booking.phone === phone
            );


        if (phoneExists) {

            showError(
                phoneInput,
                phoneError,
                "هذا الرقم لديه موعد مسجل مسبقًا."
            );

            phoneInput.focus();

            return;

        }


        /* منع نفس الاسم */

        const nameExists =
            bookings.some(
                booking =>
                    normalizeName(
                        booking.name
                    ).toLowerCase() ===
                    name.toLowerCase()
            );


        if (nameExists) {

            showError(
                nameInput,
                nameError,
                "هذا الاسم لديه موعد مسجل مسبقًا."
            );

            nameInput.focus();

            return;

        }


        /* رقم المراجع */

        const visitorNumber =
            todayBookings.length + 1;


        /* إنشاء الحجز */

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


        bookings.push(
            booking
        );


        saveBookings(
            bookings
        );


        /* عرض النجاح */

        successBox.classList.remove(
            "hidden"
        );


        /* عرض التذكرة */

        showTicket(
            booking
        );


        /* تحديث القائمة */

        updateAvailableTimes();

        renderQueue();


        /* تنظيف النموذج */

        form.reset();

        setMinimumDate();


        /* العودة لأعلى التذكرة */

        successBox.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

    }
);


/* =========================
   عرض التذكرة
========================= */

function showTicket(
    booking
) {

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
        formatDate(
            booking.date
        );


    document.getElementById(
        "ticketTime"
    ).textContent =
        formatTime(
            booking.time
        );


    ticketSection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

}


/* =========================
   قائمة المواعيد
========================= */

function renderQueue() {

    const date =
        dateInput.value;

    const bookings =
        getBookings()
            .filter(
                booking =>
                    booking.date === date
            )
            .sort(
                (a, b) =>
                    a.time.localeCompare(
                        b.time
                    )
            );


    if (bookings.length === 0) {

        queueList.innerHTML = `
            <div class="queue-empty">
                لا توجد مواعيد محجوزة لهذا اليوم.
            </div>
        `;

        return;

    }


    queueList.innerHTML = "";


    bookings.forEach(
        function (booking) {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "queue-item";


            item.innerHTML = `

                <div class="queue-number">
                    ${String(
                        booking.visitorNumber
                    ).padStart(2, "0")}
                </div>

                <div class="queue-info">

                    <strong>
                        مراجع رقم
                        ${String(
                            booking.visitorNumber
                        ).padStart(2, "0")}
                    </strong>

                    <span>
                        الساعة:
                        ${formatTime(
                            booking.time
                        )}
                    </span>

                </div>

            `;


            queueList.appendChild(
                item
            );

        }
    );

}


/* =========================
   الطباعة
========================= */

document
    .getElementById(
        "printTicket"
    )
    .addEventListener(
        "click",
        function () {

            window.print();

        }
    );


/* =========================
   حجز جديد
========================= */

document
    .getElementById(
        "newBooking"
    )
    .addEventListener(
        "click",
        function () {

            ticketSection.classList.add(
                "hidden"
            );

            successBox.classList.add(
                "hidden"
            );

            form.reset();

            setMinimumDate();

            updateAvailableTimes();

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

        }
    );


/* =========================
   التاريخ
========================= */

function formatDate(
    dateString
) {

    const date =
        new Date(
            dateString +
            "T00:00:00"
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


/* =========================
   الوقت
========================= */

function formatTime(
    time
) {

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


/* =========================
   إزالة خطأ أثناء الكتابة
========================= */

nameInput.addEventListener(
    "input",
    function () {

        clearFieldError(
            nameInput,
            nameError
        );

    }
);


phoneInput.addEventListener(
    "input",
    function () {

        clearFieldError(
            phoneInput,
            phoneError
        );

    }
);


addressInput.addEventListener(
    "input",
    function () {

        clearFieldError(
            addressInput,
            addressError
        );

    }
);


timeSelect.addEventListener(
    "change",
    function () {

        clearFieldError(
            timeSelect,
            timeError
        );

    }
);
