const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// Initialize Firebase Admin (locked security rules bypass backend execution)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

module.exports = async (req, res) => {
    // Dynamic CORS Setup
    const origin = req.headers.origin ? req.headers.origin : '*';
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const { payment_id, name, amount, seva } = req.method === 'POST' ? req.body : req.query;

        if (!payment_id || !name || !amount) {
            return res.status(400).json({ error: 'Required parameter missing' });
        }

        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // 1. Fetch real payment details directly from Razorpay API to prevent faking
        const payment = await instance.payments.fetch(payment_id);

        // 2. Razorpay returns amount in paise (1 INR = 100 Paise)
        const expectedAmountPaise = Number(amount) * 100;

        // 3. Confirm if payment is captured/authorized and amount matches exactly
        if ((payment.status === 'captured' || payment.status === 'authorized') && Number(payment.amount) === expectedAmountPaise) {
            
            // 4. Server-to-server secure write to Firebase Firestore (using paymentId as document ID to prevent duplicate entry)
            await db.collection('donations').doc(payment_id).set({
                name: decodeURIComponent(name),
                amount: Number(amount),
                seva: seva ? decodeURIComponent(seva) : 'General Donation',
                paymentId: payment_id,
                date: admin.firestore.FieldValue.serverTimestamp() // Google Server Time (un-alterable)
            });

            return res.status(200).json({ status: 'success', message: 'Real payment verified and saved securely!' });
        } else {
            return res.status(400).json({ error: 'Razorpay verification mismatch or failed status' });
        }
    } catch (error) {
        console.error("Verification server error: ", error);
        return res.status(500).json({ error: error.message || 'Verification execution failed' });
    }
};
