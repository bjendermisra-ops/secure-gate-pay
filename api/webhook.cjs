const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin securely
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

module.exports = async (req, res) => {
    // CORS Setup
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-razorpay-signature');

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

        // Cryptographically verify Razorpay's signature to prevent fake database writes
        const shasum = crypto.createHmac('sha256', webhookSecret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            return res.status(401).json({ error: 'Invalid Webhook Signature' });
        }

        const event = req.body.event;

        if (event === 'payment_link.paid') {
            const paymentLink = req.body.payload.payment_link.entity;
            const paymentEntity = req.body.payload.payment ? req.body.payload.payment.entity : null;

            const paymentId = paymentEntity ? paymentEntity.id : (paymentLink.id || 'N/A');
            const name = paymentLink.customer.name || 'Anonymous Donor';
            const amount = paymentLink.amount / 100; // convert paise to INR
            const seva = paymentLink.description || 'General Donation';
            const contact = paymentLink.customer.contact || 'N/A';
            const email = paymentLink.customer.email || '';
            const method = paymentEntity ? (paymentEntity.method || 'UPI') : 'UPI';

            let cleanEmail = email.trim();
            if (cleanEmail.includes('void@razorpay.com') || cleanEmail.includes('razorpay.com')) {
                cleanEmail = '';
            }

            // Server-to-server secure write using transaction ID as document ID (Strict Idempotency)
            await db.collection('donations').doc(paymentId).set({
                name: name,
                amount: amount,
                seva: seva,
                paymentId: paymentId,
                method: method,
                contact: contact,
                email: cleanEmail,
                date: admin.firestore.FieldValue.serverTimestamp() // Google Server Time
            });

            // --- AUTOMATED WEBHOOK EMAIL SENDER ---
            if (cleanEmail && process.env.RESEND_API_KEY) {
                try {
                    const emailHtmlTemplate = `
                        <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 500px; margin: 0 auto; border: 1.5px solid #ff9933; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); background-color: #fffcf8;">
                            <div style="background: linear-gradient(135deg, #1f0802 0%, #3d1b19 100%); padding: 30px 20px; text-align: center; border-bottom: 4px solid #ff9933;">
                                <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh89ueri3DvWfVUmM76dyYJSTCLcDC6oYuAT3j-ezAKl5iDeJ97q28vt2MR39RJwL8BGI91we6F4DRj-u7j1EE2NPyQRwFs0HfYcB4HjxZ9VoeUQWGR7GdARSdow00uHqEehsr6gOVDFG15mntfIdNuOrQ_fxAZHCjMWU9kEjzaUMhuN52vsKMA6Tb9Dtx3/s256/1000096788.png" style="width: 75px; height: 75px; border-radius: 50%; border: 2.5px solid #ff9933; background: #fff;" alt="Logo" />
                                <h1 style="color: #ffcc80; margin: 12px 0 0 0; font-size: 20px; font-weight: 800; letter-spacing: 1px;">ISKCON Bhuvaikuntha</h1>
                                <p style="color: #ececec; margin: 4px 0 0 0; font-size: 11px;">Sri Sri Radha Pandharinath Mandir - Pandharpur</p>
                            </div>
                            <div style="padding: 24px; color: #333; text-align: left; line-height: 1.6;">
                                <h2 style="color: #ff8f00; font-size: 16px; font-weight: 800; margin-top: 0;">Hare Krishna, ${name}! 🙏</h2>
                                <p style="font-size: 13px; margin-bottom: 15px;">Please accept our humble obeisances. All glories to Srila Prabhupada.</p>
                                <p style="font-size: 13px; margin-bottom: 20px;">Thank you for your generous contribution towards the construction of ISKCON Bhuvaikuntha Temple. Your donation receipt has been securely recorded on our systems:</p>
                                
                                <div style="border: 2px dashed #f28c28; background: #fffdf9; padding: 15px; border-radius: 12px; margin-bottom: 20px;">
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px; border-bottom: 1px solid #fdf5ea; padding-bottom: 6px;">
                                        <strong style="color: #666;">Seva Selected:</strong>
                                        <span style="color: #111; font-weight: bold; text-align: right;">${seva}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px; border-bottom: 1px solid #fdf5ea; padding-bottom: 6px;">
                                        <strong style="color: #666;">Amount Paid:</strong>
                                        <span style="color: green; font-weight: bold; text-align: right;">₹${amount}/-</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px; border-bottom: 1px solid #fdf5ea; padding-bottom: 6px;">
                                        <strong style="color: #666;">Transaction ID:</strong>
                                        <span style="color: #111; font-weight: bold; font-family: monospace; text-align: right;">${paymentId}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px;">
                                        <strong style="color: #666;">Payment Mode:</strong>
                                        <span style="color: #111; font-weight: bold; text-align: right;">${method.toUpperCase()}</span>
                                    </div>
                                </div>

                                <div style="background: #e8f5e9; border: 1.5px solid #c8e6c9; border-radius: 10px; padding: 12px; font-size: 11.5px; color: green; margin-bottom: 20px;">
                                    <strong style="display: block; margin-bottom: 2px;">Bhagavad Gita Wisdom:</strong>
                                    "Whatever you do, whatever you eat, whatever you offer or give away, and whatever austerities you perform — do that, O son of Kuntī, as an offering to Me." — BG 9.27
                                </div>

                                <p style="font-size: 12px; color: #777;">Note: For official 10BE (Income Tax Exemption) certificates, our accounts team will contact you securely. For any queries, please email us at bhuvaikuntha@iskcon.org or WhatsApp at +91 9226167380.</p>
                            </div>
                            <div style="background: #321614; padding: 15px; text-align: center; color: #ffcc80; font-size: 11px; font-weight: bold;">
                                🌸 Hare Krishna 🌸
                            </div>
                        </div>
                    `;

                    await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
                        },
                        body: JSON.stringify({
                            from: 'ISKCON Bhuvaikuntha <seva@iskconhadapsar.online>',
                            to: [cleanEmail],
                            subject: `Hare Krishna! Seva Receipt: ${seva} 🙏`,
                            html: emailHtmlTemplate
                        })
                    });
                    console.log("Real-time Webhook email dispatched successfully to: ", cleanEmail);
                } catch (emailError) {
                    console.error("Webhook Email dispatcher failure: ", emailError);
                }
            }

            return res.status(200).json({ status: 'success', message: 'Webhook processed and saved successfully!' });
        }

        return res.status(200).json({ status: 'ignored_event' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};
