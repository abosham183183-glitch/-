<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use Dompdf\Dompdf;
use Dompdf\Options;

require 'vendor/autoload.php';

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    
    // 1. بريد الطبيب المستلم للبيانات والـ PDF
    $doctor_email  = "hmudealali750@gmail.com";
    
    // استلام البيانات المدخلة من صفحة الحجز
    $patient_name  = $_POST['patient_name'];
    $patient_phone = $_POST['patient_phone'];
    $booking_date  = $_POST['booking_date'];
    $department    = $_POST['department'];
    $notes         = !empty($_POST['notes']) ? $_POST['notes'] : 'لا يوجد';
    $booking_id    = "DOC-" . rand(100000, 999999);

    // 2. تصميم كود HTML الخاص ببطاقة الطباعة/الـ PDF
    $htmlContent = "
    <!DOCTYPE html>
    <html lang='ar' dir='rtl'>
    <head>
        <meta charset='UTF-8'>
        <style>
            body { font-family: 'dejavu sans', sans-serif; direction: rtl; text-align: right; padding: 20px; }
            .header { text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px; margin-bottom: 20px; }
            .header h2 { color: #0056b3; margin: 0; }
            .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .table th, .table td { border: 1px solid #ccc; padding: 10px; text-align: right; }
            .table th { background-color: #f0f4f8; color: #333; }
            .footer { margin-top: 40px; font-size: 11px; text-align: center; color: #777; }
        </style>
    </head>
    <body>
        <div class='header'>
            <h2>بطاقة حجز موعد طبي</h2>
            <p>رقم الحجز: <strong>{$booking_id}</strong></p>
        </div>
        
        <table class='table'>
            <tr>
                <th>اسم المريض</th>
                <td>{$patient_name}</td>
            </tr>
            <tr>
                <th>رقم الهاتف</th>
                <td>{$patient_phone}</td>
            </tr>
            <tr>
                <th>تاريخ وتوقيت الموعد</th>
                <td>{$booking_date}</td>
            </tr>
            <tr>
                <th>العيادة / القسم</th>
                <td>{$department}</td>
            </tr>
            <tr>
                <th>ملاحظات المريض</th>
                <td>{$notes}</td>
            </tr>
        </table>

        <div class='footer'>
            <p>تم توليد هذه البطاقة تلقائياً عبر نظام الحجز الإلكتروني.</p>
        </div>
    </body>
    </html>
    ";

    // 3. تحويل الـ HTML إلى ملف PDF
    $options = new Options();
    $options->set('defaultFont', 'dejavu sans'); // يدعم الأحرف العربية
    $dompdf = new Dompdf($options);
    $dompdf->loadHtml($htmlContent);
    $dompdf->setPaper('A4', 'portrait');
    $dompdf->render();

    $pdfOutput = $dompdf->output();

    // 4. إرسال البريد الإلكتروني عبر PHPMailer
    $mail = new PHPMailer(true);

    try {
        // إعدادات خادم SMTP لإرسال الرسائل
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = 'hmudealali750@gmail.com'; // بريد المرسل (Gmail)
        $mail->Password   = 'your-app-password';       // كلمة مرور التطبيق (App Password)
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        $mail->CharSet    = 'UTF-8';

        // تعيين المرسل والمستلم (إلى بريدك مباشرة)
        $mail->setFrom('hmudealali750@gmail.com', 'نظام الحجز الطبي');
        $mail->addAddress($doctor_email, 'دكتور العيادة');

        // إرفاق ملف الـ PDF الناتج
        $mail->addStringAttachment($pdfOutput, "Booking_{$booking_id}.pdf", 'base64', 'application/pdf');

        // محتوى الرسالة
        $mail->isHTML(true);
        $mail->Subject = "حجز جديد - المريض: " . $patient_name;
        $mail->Body    = "وصلك حجز جديد برقم <b>{$booking_id}</b>.<br><br><b>اسم المريض:</b> {$patient_name}<br><b>رقم الهاتف:</b> {$patient_phone}<br><br>تجد مرفقاً مع هذه الرسالة ملف الـ PDF المطابق لبطاقة طباعة الحجز.";

        $mail->send();
        echo "<h3 style='color:green; text-align:center; margin-top:50px;'>تم إرسال طلب الحجز وملف الـ PDF إلى بريدك بنجاح.</h3>";
    } catch (Exception $e) {
        echo "حدث خطأ أثناء الإرسال: {$mail->ErrorInfo}";
    }
}
?>
