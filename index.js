const STORAGE_KEY = "doctorAppointments_v1";

const form = document.getElementById("bookingForm");
const message = document.getElementById("formMessage");

const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");

const ticketSection = document.getElementById("ticket");
const ticketContent = document.getElementById("ticketContent");

const printTicket = document.getElementById("printTicket");
const newBooking = document.getElementById("newBooking");


/* أوقات الحجز */

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
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30"
];


/* جلب الحجوزات */

function getAppointments() {

  try {

    return JSON.parse(
      localStorage.getItem(STORAGE_KEY)
    ) || [];

  } catch {

    return [];

  }

}


/* حفظ الحجوزات */

function saveAppointments(items) {

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(items)
  );

}


/* تنظيف رقم الهاتف */

function normalizePhone(value) {

  return value
    .replace(/[^\d+]/g, "")
    .replace(/^00/, "+");

}


/* تنظيف الاسم */

function normalizeName(value) {

  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

}


/* تحويل التاريخ إلى صيغة عربية */

function formatDate(value) {

  if (!value) {
    return "";
  }

  const date = new Date(
    value + "T00:00:00"
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


/* عرض رسالة */

function showMessage(text, type = "error") {

  message.textContent = text;

  message.className =
    "form-message " + type;

}


/* إخفاء الرسالة */

function clearMessage() {

  message.textContent = "";

  message.className =
    "form-message";

}


/* إضافة أوقات الحجز */

function fillTimes() {

  timeSelect.innerHTML =
    '<option value="">اختر الساعة</option>';

  appointmentTimes.forEach(function(time) {

    const option =
      document.createElement("option");

    option.value = time;

    option.textContent = time;

    timeSelect.appendChild(option);

  });

}


/* منع اختيار تاريخ قديم */

function setMinDate() {

  const now = new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      now.getDate()
    ).padStart(2, "0");

  dateInput.min =
    `${year}-${month}-${day}`;

}


/* إنشاء رقم المراجع */

function nextPatientNumber(items) {

  const max =
    items.reduce(
      function(number, appointment) {

        const current =
          Number(appointment.number);

        if (
          Number.isFinite(current)
        ) {

          return Math.max(
            number,
            current
          );

        }

        return number;

      },
      0
    );

  return max + 1;

}


/* حماية النصوص داخل بطاقة الموعد */

function escapeHtml(str) {

  return String(str).replace(
    /[&<>"']/g,
    function(character) {

      const characters = {

        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"

      };

      return characters[character];

    }
  );

}


/* عرض بطاقة الموعد */

function renderTicket(appointment) {

  ticketContent.innerHTML = `

    <div class="ticket-row">

      <span>
        رقم المراجع
      </span>

      <strong>
        ${escapeHtml(
          appointment.number
        )}
      </strong>

    </div>


    <div class="ticket-row">

      <span>
        الاسم الثلاثي
      </span>

      <strong>
        ${escapeHtml(
          appointment.fullName
        )}
      </strong>

    </div>


    <div class="ticket-row">

      <span>
        رقم الهاتف
      </span>

      <strong>
        ${escapeHtml(
          appointment.phone
        )}
      </strong>

    </div>


    <div class="ticket-row">

      <span>
        العنوان
      </span>

      <strong>
        ${escapeHtml(
          appointment.address
        )}
      </strong>

    </div>


    <div class="ticket-row">

      <span>
        التاريخ
      </span>

      <strong>
        ${escapeHtml(
          formatDate(
            appointment.date
          )
        )}
      </strong>

    </div>


    <div class="ticket-row">

      <span>
        الساعة
      </span>

      <strong>
        ${escapeHtml(
          appointment.time
        )}
      </strong>

    </div>


    <div class="ticket-row">

      <span>
        شكوى المريض
      </span>

      <strong>
        ${escapeHtml(
          appointment.complaint
        )}
      </strong>

    </div>

  `;

}


/* تنفيذ الحجز */

form.addEventListener(
  "submit",
  function(event) {

    event.preventDefault();

    clearMessage();


    /* قراءة البيانات */

    const fullName =
      document
        .getElementById("fullName")
        .value
        .trim();


    const phone =
      normalizePhone(
        document
          .getElementById("phone")
          .value
          .trim()
      );


    const address =
      document
        .getElementById("address")
        .value
        .trim();


    const date =
      dateInput.value;


    const time =
      timeSelect.value;


    const complaint =
      document
        .getElementById("complaint")
        .value
        .trim();


    /* التحقق من الاسم */

    if (
      fullName
        .split(/\s+/)
        .filter(Boolean)
        .length < 3
    ) {

      showMessage(
        "يرجى كتابة الاسم الثلاثي كاملاً."
      );

      return;

    }


    /* التحقق من الهاتف */

    if (
      phone
        .replace(/\D/g, "")
        .length < 8
    ) {

      showMessage(
        "يرجى إدخال رقم هاتف صحيح."
      );

      return;

    }


    /* التحقق من العنوان */

    if (!address) {

      showMessage(
        "يرجى كتابة العنوان."
      );

      return;

    }


    /* التحقق من التاريخ */

    if (!date) {

      showMessage(
        "يرجى اختيار تاريخ الموعد."
      );

      return;

    }


    /* التحقق من الساعة */

    if (!time) {

      showMessage(
        "يرجى اختيار ساعة الموعد."
      );

      return;

    }


    /* التحقق من الشكوى */

    if (complaint.length < 3) {

      showMessage(
        "يرجى كتابة شكوى المريض أو سبب المراجعة."
      );

      return;

    }


    /* جلب الحجوزات */

    const items =
      getAppointments();


    const nameKey =
      normalizeName(fullName);


    const phoneKey =
      normalizePhone(phone);


    /* منع تكرار رقم الهاتف */

    if (
      items.some(
        function(appointment) {

          return (
            normalizePhone(
              appointment.phone
            ) === phoneKey
          );

        }
      )
    ) {

      showMessage(
        "هذا رقم الهاتف لديه موعد مسجل مسبقاً."
      );

      return;

    }


    /* منع تكرار الاسم */

    if (
      items.some(
        function(appointment) {

          return (
            normalizeName(
              appointment.fullName
            ) === nameKey
          );

        }
      )
    ) {

      showMessage(
        "هذا الاسم لديه موعد مسجل مسبقاً."
      );

      return;

    }


    /* منع حجز نفس التاريخ والساعة */

    if (
      items.some(
        function(appointment) {

          return (
            appointment.date === date &&
            appointment.time === time
          );

        }
      )
    ) {

      showMessage(
        "هذا الموعد محجوز مسبقاً. اختر ساعة أخرى."
      );

      return;

    }


    /* إنشاء الحجز */

    const appointment = {

      number:
        nextPatientNumber(items),

      fullName:
        fullName,

      phone:
        phone,

      address:
        address,

      date:
        date,

      time:
        time,

      complaint:
        complaint,

      createdAt:
        new Date().toISOString()

    };


    /* إضافة الحجز */

    items.push(
      appointment
    );


    /* حفظ الحجز */

    saveAppointments(
      items
    );


    /* إنشاء بطاقة الموعد */

    renderTicket(
      appointment
    );


    /* إظهار البطاقة */

    ticketSection.classList.remove(
      "hidden"
    );


    /* الانتقال إلى البطاقة */

    ticketSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });


    /* رسالة نجاح */

    showMessage(
      "تم تسجيل الموعد بنجاح.",
      "ok"
    );


    /* تفريغ النموذج */

    form.reset();


    /* إعادة التاريخ الأدنى */

    setMinDate();

  }
);


/* حجز موعد جديد */

newBooking.addEventListener(
  "click",
  function() {

    ticketSection.classList.add(
      "hidden"
    );

    clearMessage();

    document
      .getElementById("booking")
      .scrollIntoView({
        behavior: "smooth"
      });

  }
);


/* طباعة بطاقة الموعد */

printTicket.addEventListener(
  "click",
  function() {

    window.print();

  }
);


/* تشغيل الموقع */

fillTimes();

setMinDate();
