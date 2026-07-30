/** ลิงก์เปิดอีเมลฉบับนี้ตรงใน Gmail จริง — สร้างจาก message id เอง ไม่ต้องเก็บ URL เต็มไว้ที่ไหน
 * authuser=email กันเคส browser login Google หลายบัญชีพร้อมกัน (ระบุด้วย email แม่นกว่า index u/0)
 */
export function gmailMessageUrl(accountEmail: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${messageId}`;
}
