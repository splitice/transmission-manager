const Transmission = require ('transmission-promise'),
      fs = require('fs'),
      fsPromises = fs.promises,
      rdr = require('readdir-recursive-promise'),
      fsExtra = require('fs-extra')

const downloadDir = "/mnt/temp/downloads/torrents/"
const transmission = new Transmission({host: '205.185.127.66'}) //,username: 'username',password: 'password'

async function doWork(){
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
        if(isSeeding(torrent.status) && torrent.secondsSeeding > 3628800){
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
                const file = extraFiles[i]
                console.log("Removing file %s from %s", file, torrent.name)
                fsExtra.removeSync(downloadDir + torrent.name + "/" + file)
            }
        }
    }
}

doWork()