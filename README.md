# 🏫 4/2 Hub — คำชะอีวิทยาคาร

ระบบจัดการข้อมูลและเงินห้องเรียน 4/2 | Node.js + Firebase Realtime Database

---

## 🚀 วิธีติดตั้ง

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. ตั้งค่า Firebase
แก้ไข `public/index.html` ในส่วน Firebase config (บรรทัดที่ ~15):
```js
const cfg = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "your-project.firebaseapp.com",
  databaseURL:       "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "111111111111",
  appId:             "1:xxx:web:xxx"
};
```

### 3. Firebase Realtime Database Rules
```json
{
  "rules": {
    "members":  { ".read": true, ".write": true },
    "payments": { ".read": true, ".write": true },
    "settings": { ".read": true, ".write": true }
  }
}
```

### 4. รัน
```bash
npm start        # Production
npm run dev      # Development (ต้องมี nodemon)
```
เปิด → http://localhost:3000

---

## 🔑 Role & สิทธิ์

| Role | สิทธิ์ |
|------|--------|
| 👑 Admin   | ทุกเมนู + Admin Dashboard |
| 🎓 Student | หน้าหลัก, รายชื่อ, เงินห้อง, ประวัติ |
| 👤 Guest   | ตามที่ Admin กำหนดใน Settings |

---

## 🔥 Firebase JSON Schema

```json
{
  "members": {
    "-UID": {
      "studentId": "66001",
      "name":      "นาย ตัวอย่าง นามสกุล",
      "tel":       "0812345678",
      "role":      "student",
      "createdAt": 1700000000000,
      "lastLogin": 1700000000000,
      "scores":    { "good": "+50", "bad": "-5", "total": "45" }
    }
  },
  "payments": {
    "-UID": {
      "studentId":   "66001",
      "studentName": "นาย ตัวอย่าง",
      "month":  5, "week": 2, "year": 2568,
      "amount": 20, "note": "",
      "by": "Admin", "ts": 1700000000000
    }
  },
  "settings": {
    "perms": { "class": false, "pay": false, "history": false }
  }
}
```

---

## 📡 API

| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/api/scores` | Login + คะแนน + ชื่อ + เบอร์ |
| POST | `/api/report` | รายงานความดี/ตัดคะแนนละเอียด |
| GET  | `/api/health` | Server health check |

---

## 🌐 Deploy

Railway / Render: push GitHub → เชื่อม repo → Start Command: `npm start`
