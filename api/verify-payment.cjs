const Razorpay = require('razorpay');
const admin = require('firebase-admin');

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

    // Strict Environment Variable Validation with detailed debug feedback
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return res.status(500).json({ 
            error: 'Razorpay API keys (RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET) are missing in secure-gate-pay Vercel project environment variables!' 
        });
    }

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        return res.status(500).json({ 
            error: 'Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY) are missing in secure-gate-pay Vercel project environment variables!' 
        });
    }

    try {
        const { payment_id, name, amount, seva } = req.method === 'POST' ? req.body : req.query;

        if (!payment_id || !name || !amount) {
            return res.status(400).json({ error: 'Required parameter missing' });
        }

        // Robust Firebase Private Key Parsing (Strips accidental wrapping double-quotes and handles newline escapes)
        let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
            privateKey = privateKey.slice(1, -1);
        }
        privateKey = privateKey.replace(/\\n/g, '\n');

        // Initialize Firebase Admin securely
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: privateKey,
                })
            });
        }
        const db = admin.firestore();

        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // Fetch real payment details directly from Razorpay API
        const payment = await instance.payments.fetch(payment_id);

        // Razorpay returns amount in paise (1 INR = 100 Paise)
        const expectedAmountPaise = Number(amount) * 100;

        // Confirm if payment is captured/authorized and amount matches exactly
        if ((payment.status === 'captured' || payment.status === 'authorized') && Number(payment.amount) === expectedAmountPaise) {
            
            // Server-to-server secure write to Firebase Firestore (using paymentId as document ID to prevent duplicate entry)
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
        
        // Deeply extract error description from Razorpay SDK or standard message to show exact cause on success screen
        const errorMessage = error.description || (error.error && error.error.description) || error.message || String(error);
        return res.status(500).json({ error: errorMessage });
    }
};
