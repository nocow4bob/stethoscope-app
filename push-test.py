import json
import requests
import sys

headers = {
    "Authorization": "key=AAAAUrErv-U:APA91bEYuS7dIRNwAsMAFJVlDDuV1EcBqlgdnFivmZtZNT2rv7tUTDVc7Fb20eI_-PVhTouucYB_Cib4Fiiw7AOMzeLZ4KQaHYjjBRqc8E8Yt8RQR_YpEd4mhMWz2NPjltErmlT5IPC3",
    "Content-Type": "application/json"
}

body = {
        "to":"dCJ9r0fPw7Y:APA91bGTiNL0Sfz74wp-OPGIQbPYwte36zpkA6SZX8pogyOQ3V0ILoWhQEY_b-aEl32Xkk5DmdmviuAINyinsCVeYqXQNmkgY8gDEW2aHC7tARxtUDaFUz1F6MuLPYMPYXWYLBPKV9DI",
        "notification": {
            "title": sys.argv[1],
            "body": sys.argv[2]
        },
        "data": {
            "foo":"bar",
            "refresh_data": 1
        }
}

url = "https://fcm.googleapis.com/fcm/send"
resp = requests.post(url, headers=headers,data=json.dumps(body))
print resp.text
