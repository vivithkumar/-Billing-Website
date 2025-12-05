# Bakery Website

Simple bakery site with menu CRUD, cart, billing, QR pay, print, clear cart and monthly sales report.

Requirements: Node.js (>=14), npm

Setup (PowerShell):

```powershell
cd "d:\Billing Website"
npm install
npm start
```

Open http://localhost:3000 in your browser.

API:
- `GET /api/menu` - list menu items
- `POST /api/menu` - create item {name, category, price, image}
- `PUT /api/menu/:id` - update item
- `DELETE /api/menu/:id` - delete item
- `POST /api/order` - create order {items: [{id, qty}]}
- `GET /api/sales?month=YYYY-MM` - monthly sales summary
- `GET /api/qrcode?amount=123&label=text` - returns QR code DataURL for amount
- `GET /api/qrcode?amount=123&label=text` - returns QR code DataURL for amount
- `GET /api/order/:id/invoice` - download invoice PDF for order
- `GET /api/sales/pdf?month=YYYY-MM` - download monthly sales report PDF

Notes:
- Images use external URLs from Unsplash. Replace with local images in `public/images/` if desired.
- This is a simple local demo implementation suitable for small shops. For production, secure endpoints and validate input thoroughly.

PDF notes:
- Server-side PDF generation uses `pdfkit`. Run `npm install` to ensure dependencies are present.
- Invoice PDF endpoint: `GET /api/order/:id/invoice`.
- Sales PDF endpoint: `GET /api/sales/pdf?month=YYYY-MM`.
