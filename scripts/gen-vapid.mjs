import webpush from 'web-push'
const k = webpush.generateVAPIDKeys()
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:you@example.com`)
