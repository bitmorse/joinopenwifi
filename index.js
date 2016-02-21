var iwlist = require('iwlist')
var wpa_supplicant = require('wireless-tools/wpa_supplicant');
var exec = require('child_process').exec;

function JoinOpenWifi(iface, delay, silent) {

  this.knownSecureNetworks = require('../known-secure-networks.json');

  this.iface = (iface || 'wlan0')
  this.tried = {}
  this.silent = silent
  this.delay = delay || 0
  this.iw = iwlist(this.iface, this.delay, this.silent)
  // wait for some time so that linux can try to associate with a known network first
  if (!this.silent && this.delay > 0) console.log('waiting ' + this.delay/1000 + ' seconds')
  setTimeout(this.start.bind(this), this.delay)
}

module.exports = function(iface, delay, silent) {
  return new JoinOpenWifi(iface, delay, silent)
}

module.exports.JoinOpenWifi = JoinOpenWifi

JoinOpenWifi.prototype.start = function() {
  var self = this
  self.iw.associated(function(err, associated) {
    if (associated) {
      if (!self.silent) console.log('already associated -- exiting')
      return process.exit()
    }else{
      //kill any old wpa supplicants
      wpa_supplicant.disable('wlan0');
      console.log("trashing old wpa_supplicants");
    }
    self.findOpenNetwork()
  })
}

JoinOpenWifi.prototype.findOpenNetwork = function() {
  var self = this
  if (!self.silent) console.log('scanning for open networks...')
  self.iw.scan(function(err, networks) {
    if (err) {
      if (!self.silent) console.log('error scanning', err)
      return process.exit()
    }

    //check if we can connect to known secure networks
    var secure_networks = self.onlySecureNetworks(networks)
    var knownNetFound = false;

    secure_networks.forEach(function(network){

      self.knownSecureNetworks.forEach(function(knownNet){
        if(network.essid === knownNet.essid){
          console.log("found known secure network: "+network.essid);
          console.log("attempting to connect to known secure network.");
          knownNetFound = true;


          var wpa_options = {
            interface: 'wlan0',
            ssid: knownNet.essid,
            passphrase: knownNet.passphrase,
            driver: 'wext'
          };

            //kill wlan0 dhclient
            exec('killall dhclient', function(err, stdout, stderr){
              console.log(err);
              console.log(stderr);
              console.log(stdout);
            });

            wpa_supplicant.enable(wpa_options, function(err, stdout, stderr) {
              // connected to the wireless network

              console.log("connected to the known secure wireless network");
              console.log(err);
              console.log(stdout);
            });



            //wait 30 seconds prior to testing for internet connection
            setTimeout(function(){
              console.log("DHCP client on");

              exec('dhclient wlan0', function(err, stdout, stderr){
                console.log(err);
                console.log(stdout);
              });

              self.iw.online(function(err) {
                if (err) {
                  if (!self.silent){
                    console.log(knownNet.essid + ' is not internet enabled. Trying open nets.');
                  }
                }
                if (!self.silent){
                  console.log('got online successfully via network: ' + knownNet.essid);
                }
                process.exit()
              })
            },
            30000);


        }
      });


    });

    //Try open wifis
    /*
    networks = self.removeSecureNetworks(networks)

    if (networks.length === 0) {
      if (!self.silent) console.log('no open networks nearby')
      return process.exit()
    }

    var network = self.getNextNetwork(networks)
    if (!self.silent) console.log('attempting to join ' + network.essid)
    self.connectToNetwork(network.essid)

    */
  })
}

JoinOpenWifi.prototype.connectToNetwork = function(essid) {
  var self = this
  this.tried[essid] = true
  self.iw.connect(essid, function(err) {
    if (err) {
      if (!self.silent) console.log('error joining ' + essid, err)
      return self.start()
    }
    self.iw.online(function(err) {
      if (err) {
        if (!self.silent) console.log(essid + ' is not internet enabled', err)
        return self.findOpenNetwork()
      }
      if (!self.silent){
        console.log('got online successfully via network: ' + essid);
      }
      process.exit()
    })
  })
}

JoinOpenWifi.prototype.removeSecureNetworks = function(networks) {
  return networks.filter(function(network) {
    return !network.encrypted;
  })
}


JoinOpenWifi.prototype.onlySecureNetworks = function(networks) {
  return networks.filter(function(network) {
    return network.encrypted;
  })
}


JoinOpenWifi.prototype.getNextNetwork = function(networks) {
  var network = networks.shift()
  if (!network) return process.exit()
  while (this.tried[network.essid]) {
    network = networks.shift()
  }
  return network
}
