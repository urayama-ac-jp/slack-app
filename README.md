# aspire

aspire is a slack app with Bolt.

## Installation

### Clone this repo:

```
git clone https://github.com/JapanOpenSystems/aspire.git
or
git clone git@github.com:JapanOpenSystems/aspire.git
```

### Set up the config:

```
cd aspire
cp ./env.template ./.env
```

Get slack secrets and edit them to the config. 

### Set up ngrok:
Download ngrok from `https://ngrok.com/download`.

Create a `ngrok.yml` file with the following data.
```
authtoken: *********************
region: jp
version: "2"
tunnels:
  aspire:
    proto: http
    addr: 3000
    subdomain: jops.co.dev.aspire
```
Start a tunnel
```
ngrok start aspire
```

### Set up slack app:
Use `manifest.yml`.  
Please rewrite `request_url` as necessary.

### Start the app:

```
yarn
yarn dev
```
