const Transmission = require ('transmission-promise'),
      fs = require('fs'),
      fsPromises = fs.promises,
      rdr = require('readdir-recursive-promise'),
      fsExtra = require('fs-extra'),
      disk = require('diskusage')

const downloadDir = "/mnt/temp/downloads/torrents/"
const transmission = new Transmission({host: '205.185.127.66'}) //,username: 'username',password: 'password'
const freeleechMode = true

async function manageTorrents(critical){
    const ret = {}
    
    const arg = await transmission.get(false, ["id","name","status","files","secondsSeeding","isPrivate","percentDone"]);
    const torrents = arg.torrents
    for(let i = 0; i < torrents.length; i++){
        const torrent = torrents[i]
        try {
            await handleTorrent(torrent, critical)
        }catch(ex){
            console.error("Unable to handle %s", ex)
        }
        for(var f in torrent.files){
            const topPath = torrent.files[f].name.match(/^([^/]+)/)[1]
            ret[topPath] = true
        }
    }
       
    return ret
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

async function handleTorrent(torrent, critical){
    const shortTime = torrent.name.indexOf("UHD") == -1 ? 1200 : 432000 /* extra time to make sure processed correctly */
    
    /* Removal on seeding completion */
    if(torrent.isPrivate && !freeleechMode){
        if(isSeeding(torrent.status) && torrent.secondsSeeding > 1451520){
            console.log("Removing private torrent %s, seeded enough", torrent.name)
            await transmission.remove([torrent.id], true)
            return
        }
    }else{
        if(isSeeding(torrent.status) && torrent.secondsSeeding > 1200){
            console.log("Removing %s torrent %s, seeded enough", torrent.isPrivate ? 'private':'public',torrent.name)
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
            for(let i = 0; i < extraFiles.length; i++){
                const file = downloadDir + extraFiles[i]
                console.log("Removing file %s from %s", file, torrent.name)
                fsExtra.removeSync(file)
            }
        }
    }

    /* Pause >90% if critical */
    if(critical){
        if(torrent.status == transmission.status.DOWNLOAD && torrent.percentDone > 0.85){
            await transmission.stop([torrent.id])
        }
    } else if(torrent.status == transmission.status.STOPPED && torrent.percentDone > 0.85) {
        await transmission.start([torrent.id])
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

async function manageSpeed(downloaded, info, infoDownload){
    const gb = 1000*1000*1000;

    /* Adjust global speeds */
    if(info.available < 4*gb || infoDownload.available < 10*gb){
        console.log("Less than 4GB remains (critical)")
        await transmission.session({"speed-limit-down": 5})
        return true
    } else if(info.available < 6*gb || infoDownload.available < 25*gb){
        console.log("Less than 6GB remains (critical)")
        await transmission.session({"speed-limit-down": 100})
        return true
    } else if(downloaded > 725 * 1000 * 1000){
        console.log("Uploaded more than 725GB (criticial)")
        await transmission.session({"speed-limit-down": 600})
        return true
    } else if(info.available < 10*gb || infoDownload.available < 50*gb){
        console.log("Less than 10GB remains (critical)")
        await transmission.session({"speed-limit-down": 3*1000})
        return true
    }else if(info.available < 20*gb){
        console.log("Less than 20GB remains (warning)")
        await transmission.session({"speed-limit-down": 10*1000})
    } else if(downloaded > 600 * 1000 * 1000){
        console.log("Uploaded more than 600GB (warning)")
        await transmission.session({"speed-limit-down": 15*1000})
    }else if(info.available < 30*gb || infoDownload.available < 150*gb){
        console.log("Less than 30GB remains (warning)")
        await transmission.session({"speed-limit-down": 20*1000})
    }else{
        console.log("Full speed ahead")
        await transmission.session({"speed-limit-down": 50*1000})
    }
}

async function checkDeleted(torrentFiles){
    const files = await fsPromises.readdir(downloadDir)
    for(var i=0;i<files.length;i++){
        const file = files[i]
        if(!torrentFiles[file] && file.indexOf(".part") == -1){
            fsExtra.removeSync(downloadDir + file)
        }
    }
}

async function doMain(){
    const downloaded = await getDownloadedToday()
    const infoRoot = await disk.check('/');
    const infoDownload = await disk.check(downloadDir);
    const critical = await manageSpeed(downloaded, infoRoot, infoDownload)
    const files = await manageTorrents(critical)
    await checkDeleted(files)
}

doMain()