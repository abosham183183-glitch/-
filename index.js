/* ----------------------------------------------------
   ⚙️ البرمجة والربط وتشفير البيانات (index.js)
---------------------------------------------------- */

// تشفير البيانات بوضع نجمات للحفاظ على الخصوصية عند العرض العام
function maskName(name) {
    if (!name) return '';
    let parts = name.trim().split(' ');
    return parts.map(part => {
        if (part.length <= 2) return part + '*';
        return part.substring(0, 2) + '***';
    }).join(' ');
}

function maskPhone(phone) {
    if (!phone) return '';
    if (phone.length < 6) return phone;
    return phone.substring(0, 3) + '****' + phone.substring(phone.length - 2);
}

// فحص حالة العيادة تلقائياً
function checkClinicStatus() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 5 = الجمعة
    const statusBadge = document.getElementById('clinicStatus');
    const bookBtn = document.getElementById('bookBtn');
    
    const todayKey = 'booked_' + now.toISOString().slice(0, 10);
    let bookings = JSON.parse(localStorage.getItem(todayKey) || '[]');

    renderQueueTable(bookings);

    if (dayOfWeek === 5) {
        if (statusBadge) {
            statusBadge.className = "status-badge status-closed";
            statusBadge.innerHTML = '<i class="fa-solid fa-door-closed"></i> العيادة مغلقة اليوم (عطلة الجمعة الأسبوعية)';
        }
        if (bookBtn) bookBtn.disabled = true;
        return;
    }

    if (bookings.length >= 16) {
        if (statusBadge) {
            statusBadge.className = "status-badge status-closed";
            statusBadge.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> اكتمل عدد الحجوزات لهذا اليوم (16 مريضاً)';
        }
        if (bookBtn) bookBtn.disabled = true;
        return;
    }

    if (statusBadge) {
        statusBadge.className = "status-badge status-open";
        statusBadge.innerHTML = `<i class="fa-solid fa-door-open"></i> العيادة مفتوحة للحجز (المتبقي: ${16 - bookings.length} أدوار)`;
    }
    if (bookBtn) bookBtn.disabled = false;
}

// حساب الموعد التقديري بناءً على رقم الدور
function calculateAppointmentTime(queueNum) {
    let startHour = 9;
    let totalMinutes = (queueNum - 1) * 30;
    let hours = startHour + Math.floor(totalMinutes / 60);
    let minutes = totalMinutes % 60;
    let ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    let formattedHour = hours > 12 ? hours - 12 : hours;
    let formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    return `${formattedHour}:${formattedMinutes} ${ampm}`;
}

// عرض جدول الحجوزات اليومية المشفر
function renderQueueTable(bookings) {
    const tbody = document.getElementById('queueTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (bookings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b;">لا توجد حجوزات مسجلة اليوم حتى الآن.</td></tr>';
        return;
    }

    bookings.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>#${index + 1}</strong></td>
            <td>${item.time}</td>
            <td>${maskName(item.name)}</td>
            <td>${maskPhone(item.phone)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// إرسال بيانات المريض تلقائياً إلى سيرفر البريد (EmailJS / API) خلف الكواليس دون تحويل المريض
function sendPatientDataToEmailServer(bookingData) {
    fetch('https://formspree.io/f/hmudealali750@gmail.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            _subject: `حجز جديد - دور #${bookingData.queueNum} (${bookingData.name})`,
            queue_number: bookingData.queueNum,
            appointment_time: bookingData.time,
            patient_name: bookingData.name,
            patient_phone: bookingData.phone,
            patient_address: bookingData.address,
            symptoms: bookingData.symptoms || "لا يوجد"
        })
    }).catch(err => console.log('Silent background email fetch executed.'));
}

// معالجة نموذج الحجز وتأكيده
function handleBooking(event) {
    event.preventDefault();

    const name = document.getElementById('patientName').value.trim();
    const phone = document.getElementById('patientPhone').value.trim();
    const address = document.getElementById('patientAddress').value.trim();
    const symptoms = document.getElementById('patientSymptoms').value.trim();

    const todayKey = 'booked_' + new Date().toISOString().slice(0, 10);
    let bookings = JSON.parse(localStorage.getItem(todayKey) || '[]');

    if (bookings.length >= 16) {
        alert("عذراً، اكتمل عدد الحجوزات اليومية!");
        return;
    }

    const queueNum = bookings.length + 1;
    const assignedTime = calculateAppointmentTime(queueNum);
    const currentDate = new Date().toLocaleDateString('ar-EG');
    const randomTicketCode = 'CLK-' + Math.floor(1000 + Math.random() * 9000);

    const newBooking = { name, phone, address, symptoms, time: assignedTime, queueNum, ticketCode: randomTicketCode };
    bookings.push(newBooking);
    localStorage.setItem(todayKey, JSON.stringify(bookings));

    // 🌟 إرسال البيانات للبريد تلقائياً من خلفية الموقع دون أي تحويل للمريض
    sendPatientDataToEmailServer(newBooking);

    // إخفاء النموذج وتجهيز التذكرة للطباعة
    document.getElementById('bookingFormContainer').style.display = 'none';

    document.getElementById('tName').innerText = maskName(name); // مشفر على الشاشة
    document.getElementById('tNameFull').innerText = name; // يظهر في الورقة المطبوعة فقط
    document.getElementById('tPhone').innerText = maskPhone(phone);
    document.getElementById('tAddress').innerText = address;
    document.getElementById('tQueue').innerText = '#' + queueNum;
    document.getElementById('tTime').innerText = assignedTime;
    document.getElementById('tDate').innerText = currentDate;
    document.getElementById('tTicketCode').innerText = randomTicketCode;
    
    document.getElementById('ticket-result').style.display = 'block';

    checkClinicStatus();
}

// نسخ تفاصيل التذكرة
function copyTicketDetails() {
    const queue = document.getElementById('tQueue').innerText;
    const time = document.getElementById('tTime').innerText;
    const textToCopy = `تذكرة حجز - عيادة د. السيد علي الخطيب\nالدور: ${queue}\nالموعد التقديري: ${time}\nالعنوان: البوكمال - شارع الزبور`;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert("تم نسخ تفاصيل التذكرة بنجاح!");
    });
}

window.onload = checkClinicStatus;
