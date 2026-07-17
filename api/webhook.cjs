const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin securely using environment variables
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
    // CORS Setup
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const signature = req.headers['x-razorpay-signature'];
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

        // Cryptographically verify Razorpay's signature to prevent fake data injections
        const shasum = crypto.createHmac('sha256', webhookSecret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            return res.status(401).json({ error: 'Invalid Webhook Signature' });
        }

        const event = req.body.event;

        if (event === 'payment_link.paid') {
            const paymentLink = req.body.payload.payment_link.entity;
            
            // Extract parameters directly from verified payload
            const name = paymentLink.customer.name || 'Anonymous Donor';
            const amount = paymentLink.amount / 100; // convert paise to INR
            const seva = paymentLink.description || 'General Donation';

            // Server-to-server secure write to Firebase Firestore
            await db.collection('donations').add({
                name: name,
                amount: amount,
                seva: seva,
                date: admin.firestore.FieldValue.serverTimestamp() // Google Server Time (un-alterable)
            });

            return res.status(200).json({ status: 'success' });
        }

        return res.status(200).json({ status: 'ignored_event' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};
