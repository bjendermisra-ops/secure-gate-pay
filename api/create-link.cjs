const Razorpay = require('razorpay');

module.exports = async (req, res) => {
    // Dynamic CORS Headers to bypass Chrome security rules
    const origin = req.headers.origin ? req.headers.origin : '*';
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', origin);
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
        const { name, amount, phone, email, seva } = req.body;

        if (!name || !amount || !phone) {
            return res.status(400).json({ error: 'Required fields missing' });
        }

        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // Strict template literals checked
        const paymentLink = await instance.paymentLink.create({
            amount: amount * 100,
            currency: "INR",
            description: `Donation for ${seva}`,
            customer: {
                name: name,
                email: email || 'donor@iskcon.org',
                contact: phone,
            },
            notify: {
                sms: false,
                email: false,
            },
            reminder_enable: false,
            callback_url: `https://${req.headers.host}/index.html?name=${encodeURIComponent(name)}&amount=${amount}&seva=${encodeURIComponent(seva)}`,
            callback_method: "get"
        });

        return res.status(200).json({ payment_url: paymentLink.short_url });
    } catch (error) {
        console.error(error);
        const errorMessage = error.description || (error.error && error.error.description) || error.message || 'Backend payment generation failed';
        return res.status(500).json({ error: errorMessage });
    }
};
