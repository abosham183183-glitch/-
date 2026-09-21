// دالة تشفير النصوص بالنجمات للحفاظ على خصوصية المرضى
function maskText(text, visibleCount = 2) {
    if (!text) return '';
    if (text.length <= visibleCount) return text;
    return text.substring(0, visibleCount) + '***';
}

// فحص حالة العيادة وتحديث واجهة المستخدم
function checkClinicStatus() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 5 يعبر عن يوم الجمعة
    const statusBadge = document.getElementById('clinicStatus');
    const bookBtn = document.getElementById('bookBtn');
    
    // استخدام مفتاح مرتبط بتاريخ اليوم لتسجيل الحجوزات اليومية
    const todayKey = 'booked_' + now.toISOString().slice(0, 10);
    let bookings = JSON.parse(localStorage.getItem(todayKey) || '[]');

    // تحديث الجدول المعروض بالبيانات المشفرة
    renderQueueTable(bookings);

    // التحقق من عطلة يوم الجمعة
    if (dayOfWeek === 5) {
        if (statusBadge) {
            statusBadge.className = "status-badge status-closed";
            statusBadge.innerHTML = '<i class="fa-solid fa-door-closed"></i> العيادة مغلقة اليوم (عطلة الجمعة الأسبوعية)';
        }
        if (bookBtn) bookBtn.disabled = true;
        return;
    }

    // التحقق من اكتمال الحد الأقصى للمرضى (16 مريضاً يومياً)
    if (bookings.length >= 16) {
        if (statusBadge) {
            statusBadge.className = "status-badge status-closed";
            statusBadge.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> اكتمل عدد الحجوزات لهذا اليوم (16 مريضاً)';
        }
        if (bookBtn) bookBtn.disabled = true;
        return;
    }

    // العيادة مفتوحة وتستقبل الحجوزات
    if (statusBadge) {
        statusBadge.className = "status-badge status-open";
        statusBadge.innerHTML = `<i class="fa-solid fa-door-open"></i> العيادة مفتوحة للحجز (المتبقي: ${16 - bookings.length} أدوار)`;
    }
    if (bookBtn) bookBtn.disabled = false;
}

// حساب الموعد التقديري للمريض بناءً على رقم الدور (بدءاً من 09:00 صباحاً و30 دقيقة لكل مريض)
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

// عرض قائمة الحجوزات اليومية في الجدول مع تشفير البيانات
function renderQueueTable(bookings) {
    const tbody = document.getElementById('queueTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (bookings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8;">لا توجد حجوزات مسجلة حتى الآن اليوم.</td></tr>';
        return;
    }

    bookings.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>#${index + 1}</strong></td>
            <td>${item.time}</td>
            <td>${maskText(item.name, 3)}</td>
            <td>${maskText(item.phone, 4)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// معالجة النموذج وتأكيد الحجز
function handleBooking(event) {
    event.preventDefault();

    const nameInput = document.getElementById('patientName');
    const phoneInput = document.getElementById('patientPhone');
    const addressInput = document.getElementById('patientAddress');
    const symptomsInput = document.getElementById('patientSymptoms');

    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    const symptoms = symptomsInput ? symptomsInput.value.trim() : '';

    const todayKey = 'booked_' + new Date().toISOString().slice(0, 10);
    let bookings = JSON.parse(localStorage.getItem(todayKey) || '[]');

    if (bookings.length >= 16) {
        alert("عذراً، اكتمل عدد الحجوزات المسموح به لهذا اليوم!");
        return;
    }

    const queueNum = bookings.length + 1;
    const assignedTime = calculateAppointmentTime(queueNum);

    // حفظ الحجز في التخزين المحلي للجهاز
    const newBooking = { name, phone, address, symptoms, time: assignedTime, queueNum };
    bookings.push(newBooking);
    localStorage.setItem(todayKey, JSON.stringify(bookings));

    // إرسال تفاصيل الموعد والدور تلقائياً إلى بريد الدكتور
    const doctorEmail = "hmudealali750@gmail.com";
    const emailSubject = encodeURIComponent(`حجز جديد - دور #${queueNum} (${name})`);
    const emailBody = encodeURIComponent(
        `تفاصيل طلب الحجز الجديد:\n` +
        `--------------------------\n` +
        `رقم الدور: #${queueNum}\n` +
        `الموعد التقديري: ${assignedTime}\n` +
        `اسم المريض: ${name}\n` +
        `رقم الهاتف: ${phone}\n` +
        `العنوان: ${address}\n` +
        `الأعراض والشكوى: ${symptoms}`
    );
    
    // فتح برنامج البريد لإرسال الإشعار
    window.open(`mailto:${doctorEmail}?subject=${emailSubject}&body=${emailBody}`, '_blank');

    // إخفاء النموذج وعرض التذكرة الرسمية
    const formContainer = document.getElementById('bookingFormContainer');
    if (formContainer) formContainer.style.display = 'none';

    document.getElementById('tName').innerText = name;
    document.getElementById('tPhone').innerText = phone;
    document.getElementById('tAddress').innerText = address;
    document.getElementById('tQueue').innerText = '#' + queueNum;
    document.getElementById('tTime').innerText = assignedTime;
    
    const ticketResult = document.getElementById('ticket-result');
    if (ticketResult) ticketResult.style.display = 'block';

    // إعادة تحديث الواجهة والجدول
    checkClinicStatus();
}

// دالة نسخ تفاصيل التذكرة إلى الحافظة
function copyTicketDetails() {
    const queue = document.getElementById('tQueue') ? document.getElementById('tQueue').innerText : '';
    const time = document.getElementById('tTime') ? document.getElementById('tTime').innerText : '';
    const name = document.getElementById('tName') ? document.getElementById('tName').innerText : '';

    const textToCopy = `تذكرة حجز عيادة د. السيد علي الخطيب\nالدور: ${queue}\nالموعد التقديري: ${time}\nاسم المريض: ${name}\nالعنوان: البوكمال - شارع الزبور`;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert("تم نسخ تفاصيل التذكرة بنجاح إلى الحافظة!");
    }).catch(() => {
        alert("حدث خطأ أثناء النسخ، يمكنك تحديد النص ونسخه يدوياً.");
    });
}

// تشغيل الفحص التلقائي عند تحميل الصفحة
window.onload = checkClinicStatus;
