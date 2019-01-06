const Transmission = require ('transmission-promise'),
      fs = require('fs'),
      fsPromises = fs.promises,
      rdr = require('readdir-recursive-promise'),
      fsExtra = require('fs-extra'),
      disk = require('diskusage')

const downloadDir = "/mnt/temp/downloads/torrents/"
const transmission = new Transmission({host: '205.185.127.66'}) //,username: 'username',password: 'password'

async function manageTorrents(){
    try {
        const arg = await transmission.get(false, ["id","name","status","files","secondsSeeding","isPrivate"]);
        const torrents = arg.torrents
        for(let i = 0; i < torrents.length; i++){
            const torrent = torrents[i]
            try {
                await handleTorrent(torrent)
            }catch(ex){
                console.error("Unable to handle %s", ex)
            }
       }
    }finally {
        //setTimeout(doWork, 6000)
    }
}

function isSeeding(state){
    return (state == transmission.status.SEED || state == transmission.status.SEED_WAIT)
}

function containsFile(files, path){
    for(let i = 0; i < files.length; i++){
        const file = files[i]
        if(file.name.startsWith(path)){
            return true
        }
    }
    return false
}

function findExtra(d, torrentFiles, root = ""){
    let toDelete = []
    for(let i = 0; i < d.files.length; i++){
        const file = d.files[i]
        let path
        if(file.path){ // directory
            path = root + file.name + "/"
            if(containsFile(torrentFiles, path)){
                toDelete = toDelete.concat(findExtra(file, torrentFiles, path))
            }else {
                toDelete.push(path)
            }
        }else{
            path = root + file.name
            if(!containsFile(torrentFiles, path)){
                toDelete.push(path)
            }
        }
    }
    return toDelete
}

async function handleTorrent(torrent){
    /* Removal on seeding completion */
    if(torrent.isPrivate){
        if(isSeeding(torrent.status) && torrent.secondsSeeding > 1451520){
            console.log("Removing private torrent %s, seeded enough", torrent.name)
            await transmission.remove([torrent.id], true)
            return
        }
    }else{
        if(isSeeding(torrent.status) && torrent.secondsSeeding > 1200){
            console.log("Removing public torrent %s, seeded enough", torrent.name)
            await transmission.remove([torrent.id], true)
            return
        }
    }

    /* Removal of extra files */
    if(isSeeding(torrent.status) && torrent.secondsSeeding > 43200 && torrent.files.length > 1){
        const path = downloadDir+torrent.name;
        const d = await rdr.readdirAsync(path)
        if(d){
            const extraFiles = findExtra(d, torrent.files, torrent.name + "/")
            for(var i = 0; i < extraFiles.length; i++){
                const file = downloadDir + extraFiles[i]
                console.log("Removing file %s from %s", file, torrent.name)
                fsExtra.removeSync(file)
            }
        }
    }
}

async function getDownloadedToday(){
    const now = new Date()
    const date = now.getFullYear()+'-'+now.getMonth()+'-'+now.getDate()
    try {
        const kb = parseFloat(await fsPromises.readFile("/var/uploaddb/"+date+".kbytes"))
    }catch(ex){
        return 0
    }
    return kb
}

async function manageSpeed(){
    const gb = 1000*1000*1000;

    const downloaded = await getDownloadedToday()

    const info = await disk.check('/');
    if(info.available < 4*gb){
        console.log("Less than 4GB remains (critical)")
        await transmission.session({"speed-limit-down": 5})
    } else if(info.available < 6*gb){
        console.log("Less than 6GB remains (critical)")
        await transmission.session({"speed-limit-down": 100})
    } else if(downloaded > 725 * 1000 * 1000){
        console.log("Uploaded more than 725GB (criticial)")
        await transmission.session({"speed-limit-down": 600})
    } else if(info.available < 10*gb){
        console.log("Less than 10GB remains (critical)")
        await transmission.session({"speed-limit-down": 5*1000})
    }else if(info.available < 20*gb){
        console.log("Less than 20GB remains (warning)")
        await transmission.session({"speed-limit-down": 10*1000})
    } else if(downloaded > 600 * 1000 * 1000){
        console.log("Uploaded more than 600GB (warning)")
        await transmission.session({"speed-limit-down": 15*1000})
    }else if(info.available < 30*gb){
        console.log("Less than 30GB remains (warning)")
        await transmission.session({"speed-limit-down": 20*1000})
    }else{
        console.log("Full speed ahead")
        await transmission.session({"speed-limit-down": 50*1000})
    }
}

manageTorrents()
manageSpeed()