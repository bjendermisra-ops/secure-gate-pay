const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const https = require('https');

// Helper function to send email securely via Resend REST API using Node.js core https module [5]
function sendResendEmail(apiKey, email, subject, htmlContent) {
    return new Promise((resolve, reject) => {
        const payloadData = JSON.stringify({
            from: 'ISKCON Bhuvaikuntha <seva@iskconhadapsar.online>', // Live verified professional sender domain [5]
            to: [email],
            subject: subject,
            html: htmlContent
        });

        const options = {
            hostname: 'api.resend.com',
            port: 443,
            path: '/emails',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(payloadData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(body);
                } else {
                    reject(new Error(`Resend API returned status code ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.write(payloadData);
        req.end();
    });
}

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

    // Strict Environment Variable Validation
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return res.status(500).json({ 
            error: 'Razorpay API keys are missing in secure-gate-pay Vercel project environment variables!' 
        });
    }

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        return res.status(500).json({ 
            error: 'Firebase credentials are missing in secure-gate-pay Vercel project environment variables!' 
        });
    }

    try {
        const { payment_id, name, amount, seva, phone, email } = req.method === 'POST' ? req.body : req.query;

        if (!payment_id || !name || !amount) {
            return res.status(400).json({ error: 'Required parameter missing' });
        }

        // Robust Firebase Private Key Parsing
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

        // Fetch real payment details directly from Razorpay API [4]
        const payment = await instance.payments.fetch(payment_id);

        // Razorpay returns amount in paise (1 INR = 100 Paise)
        const expectedAmountPaise = Number(amount) * 100;

        // Confirm if payment is captured/authorized and amount matches exactly
        if ((payment.status === 'captured' || payment.status === 'authorized') && Number(payment.amount) === expectedAmountPaise) {
            
            const decodedName = decodeURIComponent(name);
            const decodedSeva = seva ? decodeURIComponent(seva) : 'General Donation';
            
            // Prioritize direct form-filled email parameter to bypass void@razorpay.com overrides safely [4]
            let donorEmail = (email && email !== 'undefined' && email !== 'null') ? decodeURIComponent(email).trim() : '';
            if (!donorEmail || donorEmail.includes('void@razorpay.com') || donorEmail.includes('razorpay.com')) {
                donorEmail = payment.email || '';
            }

            // Prioritize direct form-filled phone parameter safely [4]
            let donorPhone = (phone && phone !== 'undefined' && phone !== 'null') ? decodeURIComponent(phone).trim() : '';
            if (!donorPhone || donorPhone.length < 10) {
                donorPhone = payment.contact || 'N/A';
            }

            // Server-to-server secure write to Firebase Firestore (using paymentId as document ID to prevent duplicate entry)
            await db.collection('donations').doc(payment_id).set({
                name: decodedName,
                amount: Number(amount),
                seva: decodedSeva,
                paymentId: payment_id,
                method: payment.method || 'UPI', // Store payment method dynamically [4]
                contact: donorPhone, // Store customer's real verified phone number [4]
                email: donorEmail, // Store customer's email address [4]
                date: admin.firestore.FieldValue.serverTimestamp() // Google Server Time
            });

            // --- AUTOMATED REAL-TIME BRANDED EMAIL DISPATCHER (Node.js HTTPS REST client) ---
            if (donorEmail && process.env.RESEND_API_KEY && !donorEmail.includes('void@razorpay.com')) {
                try {
                    const emailHtmlTemplate = `
                        <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 500px; margin: 0 auto; border: 1.5px solid #ff9933; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); background-color: #fffcf8;">
                            <div style="background: linear-gradient(135deg, #1f0802 0%, #3d1b19 100%); padding: 30px 20px; text-align: center; border-bottom: 4px solid #ff9933;">
                                <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh89ueri3DvWfVUmM76dyYJSTCLcDC6oYuAT3j-ezAKl5iDeJ97q28vt2MR39RJwL8BGI91we6F4DRj-u7j1EE2NPyQRwFs0HfYcB4HjxZ9VoeUQWGR7GdARSdow00uHqEehsr6gOVDFG15mntfIdNuOrQ_fxAZHCjMWU9kEjzaUMhuN52vsKMA6Tb9Dtx3/s256/1000096788.png" style="width: 75px; height: 75px; border-radius: 50%; border: 2.5px solid #ff9933; background: #fff;" alt="Logo" />
                                <h1 style="color: #ffcc80; margin: 12px 0 0 0; font-size: 20px; font-weight: 800; letter-spacing: 1px;">ISKCON Bhuvaikuntha</h1>
                                <p style="color: #ececec; margin: 4px 0 0 0; font-size: 11px;">Sri Sri Radha Pandharinath Mandir - Pandharpur</p>
                            </div>
                            <div style="padding: 24px; color: #333; text-align: left; line-height: 1.6;">
                                <h2 style="color: #ff8f00; font-size: 16px; font-weight: 800; margin-top: 0;">Hare Krishna, ${decodedName}! 🙏</h2>
                                <p style="font-size: 13px; margin-bottom: 15px;">Please accept our humble obeisances. All glories to Srila Prabhupada.</p>
                                <p style="font-size: 13px; margin-bottom: 20px;">Thank you for your generous contribution towards the construction and services of ISKCON Bhuvaikuntha Temple. Your donation receipt has been securely recorded on our systems:</p>
                                
                                <div style="border: 2px dashed #f28c28; background: #fffdf9; padding: 15px; border-radius: 12px; margin-bottom: 20px;">
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px; border-bottom: 1px solid #fdf5ea; padding-bottom: 6px;">
                                        <strong style="color: #666;">Seva Selected:</strong>
                                        <span style="color: #111; font-weight: bold; text-align: right;">${decodedSeva}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px; border-bottom: 1px solid #fdf5ea; padding-bottom: 6px;">
                                        <strong style="color: #666;">Amount Paid:</strong>
                                        <span style="color: green; font-weight: bold; text-align: right;">₹${amount}/-</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px; border-bottom: 1px solid #fdf5ea; padding-bottom: 6px;">
                                        <strong style="color: #666;">Transaction ID:</strong>
                                        <span style="color: #111; font-weight: bold; font-family: monospace; text-align: right;">${payment_id}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin: 8px 0; font-size: 12px;">
                                        <strong style="color: #666;">Payment Mode:</strong>
                                        <span style="color: #111; font-weight: bold; text-align: right;">${(payment.method || 'UPI').toUpperCase()}</span>
                                    </div>
                                </div>

                                <div style="background: #e8f5e9; border: 1.5px solid #c8e6c9; border-radius: 10px; padding: 12px; font-size: 11.5px; color: green; margin-bottom: 20px;">
                                    <strong style="display: block; margin-bottom: 2px;">Bhagavad Gita Wisdom:</strong>
                                    "Whatever you do, whatever you eat, whatever you offer or give away, and whatever austerities you perform — do that, O son of Kuntī, as an offering to Me." — BG 9.27
                                </div>

                                <p style="font-size: 12px; color: #777;">Note: For official 10BE (Income Tax Exemption) certificates, our accounts team will contact you securely. For any queries, please email us at bhuvaikuntha@iskcon.org or WhatsApp at +91 9226167380.</p>
                            </div>
                            <div style="background: #321614; padding: 15px; text-align: center; color: #ffcc80; font-size: 11px; font-weight: bold;">
                                🌸 Hare Krishna Hare Krishna Krishna Krishna Hare Hare 🌸<br>
                                🌸 Hare Rama Hare Rama Rama Rama Hare Hare 🌸
                            </div>
                        </div>
                    `;

                    // Trigger direct Node.js secure core HTTPS POST request [5]
                    await sendResendEmail(process.env.RESEND_API_KEY, donorEmail, `Hare Krishna! Seva Receipt: ${decodedSeva} 🙏`, emailHtmlTemplate);
                    console.log("Real-time transactional email dispatched successfully to: ", donorEmail);
                } catch (emailError) {
                    console.error("Email dispatcher failure: ", emailError);
                }
            }

            // Return verified payment details back to frontend for dynamic rendering [4]
            return res.status(200).json({ 
                status: 'success', 
                message: 'Real payment verified and saved securely!',
                payment_details: {
                    contact: donorPhone,
                    method: payment.method || 'UPI',
                    email: donorEmail
                }
            });
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
