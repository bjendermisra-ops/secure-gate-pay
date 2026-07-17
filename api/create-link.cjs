const Razorpay = require('razorpay');

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
        const { name, amount, phone, email, seva } = req.body;

        if (!name || !amount || !phone) {
            return res.status(400).json({ error: 'Required fields missing' });
        }

        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const paymentLink = await instance.paymentLink.create({
            amount: amount * 100,
            currency: "INR",
            description: seva,
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
            // Custom redirect to success page in project 2 after payment is completed
            callback_url: `https://${req.headers.host}/index.html?name=${encodeURIComponent(name)}&amount=${amount}&seva=${encodeURIComponent(seva)}`,
            callback_method: "get"
        });

        return res.status(200).json({ payment_url: paymentLink.short_url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};
