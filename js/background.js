'use strict'

//-----------
// Variables
//-----------
var s = { // s is short for Sprucemarks
    'a': { // arrays
        'delay_queue': [],   // if option "create_delay" is true then keep track of which ids and folders will be sorted once option "create_delay_detail" seconds have passed
        'reorder_queue': [], // keep track of the sort order for a particular folder while it is being processed
        'sort_queue': []     // keep track of which folder IDs have been queued for sorting
    },
    'ancestorID': { // keeps track of the bookmark IDs for root bookmark elements, each of these will itself have a parent with the ID of 0
        'bookmarks_bar'   : null, // usually ID 1
        'other_bookmarks' : null, // usually ID 2
        'mobile_bookmarks': null  // usually ID 3
    },
    'defaults': {
        'option_create_delay'             : '1',
        'option_create_delay_detail'      : '45',
        'option_bookmarks_bar_sort'       : '',
        'option_bookmarks_bar_sub_sort'   : '',
        'option_other_bookmarks_sort'     : '',
        'option_other_bookmarks_sub_sort' : '',
        'option_mobile_bookmarks_sort'    : '',
        'option_mobile_bookmarks_sub_sort': ''
    },
    'delay_timer': '', // used to keep track of one setTimeout call when the option create_delay is enabled and a bookmark onCreate event has happened
    'log': false, // make sure this is false when publishing to the chrome web store
    'new_options': false, // will be set to true if new options are available
    'show_notification': false, // set to true to show the latest notification in the notify directory
    'status': {
        'import_active'   : false, // true if bookmarks are actively being imported
        'listeners_active': false, // true if maintenance listeners are active
        'sort_active'     : 0      // if greater than 0, delay activation of the maintenance listeners
    },
    'version': {
        'current': function() {
            return chrome.app.getDetails().version
        },
        'local': async function(set) {
            if (set === undefined) {
                var version = await storageGet('version')
                if (version === undefined) {
                    return localStorage['version'] // for versions prior to 2018.2.10.0 which used localStorage
                } else {
                    return version
                }
            } else {
                await storageSet({
                    'version': this.current()
                })
            }
        }
    }
} // s

//-----------
// Functions
//-----------
function local_version_less_than(local, compare) {
    var outcome = false
    local = local.split('.').reverse()
    compare = compare.split('.').reverse()
    var i = local.length
    while (i--) { // convert every element to integers for easy comparison
        local[i] = parseInteger(local[i])
        compare[i] = parseInteger(compare[i])
    }
    i = local.length
    the_ice:
    while (i--) {
        if (local[i] > compare[i]) {
            break the_ice
        } else if (local[i] < compare[i]) {
            outcome = true
            break the_ice // especially at parties
        }
    }
    return outcome
} // local_version_less_than

function log(o) {
    if (s.log) {
        console.log(o)
    }
} // log

function parseInteger(val) {
    return parseInt(val, 10)
} // parseInteger

async function stop_collaborate_and_listen(request, sender, sendResponse) {
    // Ice is back with a brand new function
    if (request.request === 'options') {
        // return all our options
        sendResponse(s.option)
    } else if (request.request === 'options_set') {
        // set our options
        sendResponse({'message': 'thanks'})

        var val
        log(request.option)
        s.option = request.option // overwrite our local copy of options with any potentially changed values
        for (var i in s.option) { // save all options to storage
            if (s.option[i] === true) {
                val = '1'
            } else if (s.option[i] === false) {
                val = '0'
            } else {
                val = s.option[i]
            }
            await storageSet({['option_' + i]: val})
        }
        s.resort()
    }
} // stop_collaborate_and_listen

async function storageGet(key) {
    return await new Promise(function(resolve, reject) {
        chrome.storage.local.get(key, function(obj) {
            // obj can be an empty object
            // obj will never be undefined according to https://developer.chrome.com/apps/storage#method-StorageArea-get
            resolve(obj[key]) // this however, can be undefined
        })
    })
} // storageGet

async function storageSet(obj) {
    await new Promise(function(resolve, reject) {
        chrome.storage.local.set(obj, function() {
            resolve()
        })
    })
} // storageSet

//-------------------------------
// Functions: Sprucemarks Object
//-------------------------------
s.delay_sort = function s_delay_sort() {
    var i = s.a.delay_queue.length
    log('delay_sort processing queued up bookmarks.')
    while (i--) {
        s.sort_buffer(s.a.delay_queue[i][0], s.a.delay_queue[i][1]) // bookmark id, parent folder id
    }
    s.a.delay_queue = []
} // s.delay_sort

s.findAncestors = function s_findAncestors(callback) {
    /*
    Find IDs for root level containers like the Bookmarks Bar, Mobile Bookmarks, and Other Bookmarks.
    @param  {Function}  [callback]  Optional callback function.

    Callback Usage
        s.findAncestors(function() { console.log('done') })
    */
    chrome.bookmarks.getChildren('0', function(o) {
        for (var i in o) {
            var title = o[i].title.toLowerCase()
            var id = parseInteger(o[i].id)

            if (title === 'bookmarks bar') {
                s.ancestorID.bookmarks_bar = id
            } else if (title === 'other bookmarks') {
                s.ancestorID.other_bookmarks = id
            } else if (title === 'mobile bookmarks') {
                s.ancestorID.mobile_bookmarks = id
            }
        }

        if (s.ancestorID.bookmarks_bar === null) {
            s.ancestorID.bookmarks_bar = 1 // best guess
            console.log('s.findAncestors -> Had to guess ID for s.ancestorID.bookmarks_bar')
        }

        if (s.ancestorID.other_bookmarks === null) {
            s.ancestorID.other_bookmarks = 2 // best guess
            console.log('s.findAncestors -> Had to guess ID for s.ancestorID.other_bookmarks')
        }

        if (s.ancestorID.mobile_bookmarks === null) {
            s.ancestorID.mobile_bookmarks = 3 // best guess
            console.log('s.findAncestors -> Had to guess ID for s.ancestorID.mobile_bookmarks')
        }

        if (typeof(callback) === 'function') {
            callback()
        }
    })
} // s.findAncestors

s.get = function s_get(id, callback) { //
    /*
    Helper function for humans that are poking around.
    @param  {Number}    id          Bookmark ID.
    @param  {Function}  [callback]  Optional callback function.

    Callback Usage
        s.get(123, function(obj) { a = obj })
    */
    chrome.bookmarks.get(id.toString(), function(obj) {
        if (typeof(callback) === 'function') {
            callback(obj[0])
        } else {
            console.log(obj[0])
        }
    })
} // s.get

s.get_ancestor_then_sort = function s_get_ancestor_then_sort(id, relay_id, parent_id, recurse) {
    chrome.bookmarks.get(id.toString(), function(o) {
        if (typeof o === 'undefined') {
            // oops, the bookmark we wanted to sort has been deleted before we could get to it
            s.sort(relay_id, parent_id, recurse, id)
        } else {
            if (parseInteger(o[0].parentId) === 0) {
                s.sort(relay_id, parent_id, recurse, id)
            } else {
                // keep searching for the eldest ancestor
                s.get_ancestor_then_sort(o[0].parentId, relay_id, parent_id, recurse)
            }
        }
    })
} // s.get_ancestor_then_sort

s.init = function s_init() {
    chrome.bookmarks.onImportBegan.addListener(function() {
        s.status.import_active = true
        log('Import began')
    })

    chrome.bookmarks.onImportEnded.addListener(function() {
        log('Import finished')

        s.findAncestors(function() {
            chrome.bookmarks.getChildren('0', function(o) {
                for (var i in o) {
                    s.a.sort_queue.push(o[i].id)
                    s.sort(o[i].id, o[i].id, 'recurse')
                }
                s.status.import_active = false
            })
        })
    })

    chrome.bookmarks.onMoved.addListener(function(id, moveInfo) { // this listener is always active by intention
        if (!s.status.import_active) {
            log('onMoved (all time) > id = ' + id)
            s.reorder_queue(moveInfo.parentId)
        }
    })

    s.findAncestors(function() {
        chrome.bookmarks.getChildren('0', function(o) {
            for (var i in o) {
                s.sort(o[i].id, o[i].id, 'recurse')
            }
            setTimeout(s.listeners, 500) // wait a short while before attempting to activate bookmark change listeners so we don't get notified about our own initial sorting activity
        })
    })
} // s.init

s.install_or_upgrade = async function s_install_or_upgrade() {
    var local_version = await s.version.local()
    var check_version = ''

    // If the localStorage version does not match our manifest version then we have a first install or upgrade.
    if (local_version !== s.version.current()) {
        if (local_version === undefined) {
            // first install
            log('First install')
            await storageSet({'option_group_folders'       : '1'})
            await storageSet({'option_bookmarks_bar'       : '0'})
            await storageSet({'option_bookmarks_bar_sub'   : '0'})
            await storageSet({'option_other_bookmarks'     : '0'})
            await storageSet({'option_other_bookmarks_sub' : '0'})
            await storageSet({'option_mobile_bookmarks'    : '0'})
            await storageSet({'option_mobile_bookmarks_sub': '0'})

            await storageSet({'option_create_delay'       : s.defaults.option_create_delay})
            await storageSet({'option_create_delay_detail': s.defaults.option_create_delay_detail})

            await storageSet({'option_bookmarks_bar_sort'       : s.defaults.option_bookmarks_bar_sort})
            await storageSet({'option_bookmarks_bar_sub_sort'   : s.defaults.option_bookmarks_bar_sub_sort})
            await storageSet({'option_other_bookmarks_sort'     : s.defaults.option_other_bookmarks_sort})
            await storageSet({'option_other_bookmarks_sub_sort' : s.defaults.option_other_bookmarks_sub_sort})
            await storageSet({'option_mobile_bookmarks_sort'    : s.defaults.option_mobile_bookmarks_sort})
            await storageSet({'option_mobile_bookmarks_sub_sort': s.defaults.option_mobile_bookmarks_sub_sort})
            s.new_options = true

            // show notification
            s.show_notification = true
        } else {
            // check for upgrade tasks
            var messageUpgrade = 'Upgrade task for versions less than: '

            check_version = '2012.8.13.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // remove the console logging option
                localStorage.removeItem('option_console_logs')
                s.new_options = true
            }

            check_version = '2012.10.15.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // add the delay sorting for new bookmarks option
                localStorage['option_create_delay']        = s.defaults.option_create_delay
                localStorage['option_create_delay_detail'] = s.defaults.option_create_delay_detail
                s.new_options = true
            }

            check_version = '2015.7.6.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // remove google sync workaround
                localStorage.removeItem('option_sync')
            }

            check_version = '2016.4.6.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // add new sorting options
                localStorage['option_bookmarks_bar_sort']       = s.defaults.option_bookmarks_bar_sort
                localStorage['option_bookmarks_bar_sub_sort']   = s.defaults.option_bookmarks_bar_sub_sort
                localStorage['option_other_bookmarks_sort']     = s.defaults.option_other_bookmarks_sort
                localStorage['option_other_bookmarks_sub_sort'] = s.defaults.option_other_bookmarks_sub_sort
                s.new_options = true
            }

            check_version = '2016.11.6.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // add new mobile bookmarks sorting options
                localStorage['option_mobile_bookmarks_sort']     = s.defaults.option_mobile_bookmarks_sort
                localStorage['option_mobile_bookmarks_sub_sort'] = s.defaults.option_mobile_bookmarks_sub_sort
                s.new_options = true
            }

            check_version = '2018.2.10.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // migrate from localStorage to chrome.storage
                await storageSet({'option_group_folders'       : localStorage['option_group_folders']})
                await storageSet({'option_bookmarks_bar'       : localStorage['option_bookmarks_bar']})
                await storageSet({'option_bookmarks_bar_sub'   : localStorage['option_bookmarks_bar_sub']})
                await storageSet({'option_other_bookmarks'     : localStorage['option_other_bookmarks']})
                await storageSet({'option_other_bookmarks_sub' : localStorage['option_other_bookmarks_sub']})
                await storageSet({'option_mobile_bookmarks'    : localStorage['option_mobile_bookmarks']})
                await storageSet({'option_mobile_bookmarks_sub': localStorage['option_mobile_bookmarks_sub']})

                await storageSet({'option_create_delay'       : localStorage['option_create_delay']})
                await storageSet({'option_create_delay_detail': localStorage['option_create_delay_detail']})

                await storageSet({'option_bookmarks_bar_sort'       : localStorage['option_bookmarks_bar_sort']})
                await storageSet({'option_bookmarks_bar_sub_sort'   : localStorage['option_bookmarks_bar_sub_sort']})
                await storageSet({'option_other_bookmarks_sort'     : localStorage['option_other_bookmarks_sort']})
                await storageSet({'option_other_bookmarks_sub_sort' : localStorage['option_other_bookmarks_sub_sort']})
                await storageSet({'option_mobile_bookmarks_sort'    : localStorage['option_mobile_bookmarks_sort']})
                await storageSet({'option_mobile_bookmarks_sub_sort': localStorage['option_mobile_bookmarks_sub_sort']})

                // so long, and thanks for all the fish
                localStorage.clear()
            }

            check_version = '2019.12.1.0'
            if (local_version_less_than(local_version, check_version)) {
                log(messageUpgrade + check_version)
                // show notification
                s.show_notification = true
            }
        }

        if (s.show_notification) {
            // show latest notification
            chrome.tabs.create({
                url: '/notify/2019-december.html'
            })
        }

        // update the storage version for next time
        s.version.local('set')
    }
} // s.install_or_upgrade

s.listeners = function s_listeners() {
    if (s.status.sort_active > 0) {
        // sorting is still active, will try to activate listeners again in 500 milliseconds
        setTimeout(s.listeners, 500)
    } else {
        // activate listeners so we can keep things organized
        s.status.listeners_active = true

        chrome.bookmarks.onCreated.addListener(function(id, bookmark) {
            if (!s.status.import_active) {
                log('onCreated > id = ' + id)
                if (s.option.create_delay) {
                    clearTimeout(s.delay_timer)
                    s.a.delay_queue.push([id, bookmark.parentId])
                    s.delay_timer = setTimeout(s.delay_sort, s.option.create_delay_detail + '000')
                } else {
                    s.sort_buffer(id, bookmark.parentId)
                }
            }
        })

        chrome.bookmarks.onChanged.addListener(function(id, changeInfo) {
            if (!s.status.import_active) {
                log('onChanged > id = ' + id)
                chrome.bookmarks.get(id, function(a) {
                    s.sort_buffer(a[0].id, a[0].parentId)
                })
            }
        })

        chrome.bookmarks.onMoved.addListener(function(id, moveInfo) {
            if (!s.status.import_active) {
                log('onMoved > id = ' + id + ', ' + moveInfo.parentId)
                log(moveInfo)

                s.sort_buffer(id, moveInfo.parentId)
            }
        })

        chrome.bookmarks.onChildrenReordered.addListener(function(id, reorderInfo) {
            // seems like onChildrenReordered only gets called if you use the 'Reorder by Title' function in the Bookmark Manager
            if (!s.status.import_active) {
                log('onChildrenReordered > id = ' + id)
                // Chrome sorts nicely in this situation (folders then files) but if the user likes folders and files mixed we should run our sort.
                if (!s.option.group_folders) {
                    s.sort_buffer(id, id)
                }
            }
        })
        log('All listeners active.\n')
    }
} // s.listeners

s.ready_options = async function s_ready_options() {
    //----------------------------------------------
    // Set options based on storage values (if any)
    //----------------------------------------------
    s.option = {
        'group_folders'       : (await storageGet('option_group_folders') == 1)        ? true : false,
        'bookmarks_bar'       : (await storageGet('option_bookmarks_bar') == 1)        ? true : false,
        'bookmarks_bar_sub'   : (await storageGet('option_bookmarks_bar_sub') == 1)    ? true : false,
        'other_bookmarks'     : (await storageGet('option_other_bookmarks') == 1)      ? true : false,
        'other_bookmarks_sub' : (await storageGet('option_other_bookmarks_sub') == 1)  ? true : false,
        'mobile_bookmarks'    : (await storageGet('option_mobile_bookmarks') == 1)     ? true : false,
        'mobile_bookmarks_sub': (await storageGet('option_mobile_bookmarks_sub') == 1) ? true : false,
        'create_delay'        : (await storageGet('option_create_delay') == 1)         ? true : false,
        'create_delay_detail' : (await storageGet('option_create_delay_detail') >= 0)  ? await storageGet('option_create_delay_detail') : s.defaults.option_create_delay_detail
    }

    // sorting options
    s.option.bookmarks_bar_sort        = (typeof(await storageGet('option_bookmarks_bar_sort'))        === 'string') ? await storageGet('option_bookmarks_bar_sort')        : s.defaults.option_bookmarks_bar_sort
    s.option.bookmarks_bar_sub_sort    = (typeof(await storageGet('option_bookmarks_bar_sub_sort'))    === 'string') ? await storageGet('option_bookmarks_bar_sub_sort')    : s.defaults.option_bookmarks_bar_sub_sort

    s.option.other_bookmarks_sort      = (typeof(await storageGet('option_other_bookmarks_sort'))      === 'string') ? await storageGet('option_other_bookmarks_sort')      : s.defaults.option_other_bookmarks_sort
    s.option.other_bookmarks_sub_sort  = (typeof(await storageGet('option_other_bookmarks_sub_sort'))  === 'string') ? await storageGet('option_other_bookmarks_sub_sort')  : s.defaults.option_other_bookmarks_sub_sort

    s.option.mobile_bookmarks_sort     = (typeof(await storageGet('option_mobile_bookmarks_sort'))     === 'string') ? await storageGet('option_mobile_bookmarks_sort')     : s.defaults.option_mobile_bookmarks_sort
    s.option.mobile_bookmarks_sub_sort = (typeof(await storageGet('option_mobile_bookmarks_sub_sort')) === 'string') ? await storageGet('option_mobile_bookmarks_sub_sort') : s.defaults.option_mobile_bookmarks_sub_sort

    if (s.new_options) {
        // first time or new options are available so show the options page
        log('New options are available.')
        chrome.tabs.create({url: 'options.html'})
    }

    log('Ready to sort.')
} // s.ready_options

s.recent_folders_search = function s_recent_folders_search(id) {
    id = parseInteger(id)
    var i,
        count = 0
    for (i in s.a.recent_folders) {
        if (s.a.recent_folders[i][0] === id) {
            count++
        }
    }
    if (count > 0) {
        return true
    } else {
        return false
    }
} // s.recent_folders_search

s.reorder = function s_reorder(o) {
    var already_exists = false

    for (var i in s.a.reorder_queue) { // check because in a very specific timing sensitive scenario (usually initiated by resorting everything because an option changed) things can get added twice
        if (s.a.reorder_queue[i][0] === o[0].parentId) {
            already_exists = true
        }
    }

    if (!already_exists) {
        s.a.reorder_queue.push([o[0].parentId, o, 0]) // parent id, sorted array, next item to process
        s.reorder_queue(o[0].parentId)
    }
} // s.reorder

s.reorder_queue = function s_reorder_queue(parent_id) {
    parent_id = parseInteger(parent_id)
    log('s.reorder_queue > parent_id = ' + parent_id)

    s.status.sort_active++

    chrome.bookmarks.getChildren(parent_id.toString(), function(oh) {
        var i, o, x, y
        var accurate_index = 0
        parent_id = parseInteger(oh[0].parentId)
        for (i in s.a.reorder_queue) {
            if (parseInteger(s.a.reorder_queue[i][0]) === parent_id) { // we found the array for our parent object that is being sorted
                log('s.reorder_queue > s.a.reorder_queue[i][0] = ' + s.a.reorder_queue[i][0])
                o = s.a.reorder_queue[i]
                log(o) // Chrome doesn't actually console log array and object values an exact moment in time so results can be a bit different than you expect

                for (x = o[2]; x < o[1].length; x++) {
                    // we only want to move bookmarks we have to in order to minimize the hit against Chrome's quota system
                    // so we will check every item individually and see if its index needs to be updated
                    // why check each item instead of doing it ahead of time? index numbers can shift as bookmarks are reordered

                    accurate_index = 0

                    for (y = 0; y < oh.length; y++) {
                        if (oh[y].id === o[1][x].id) {
                            accurate_index = oh[y].index
                            y = oh.length + 1
                        }
                    }

                    o[2] = parseInteger(o[2]) + 1 // increment our position value for next time

                    if (x === accurate_index) {
                        // this item is already in the perfect location so we don't have to do anything
                        log('s.reorder_queue > id ' + o[1][x].id + ' already in position ' + x)
                    } else {
                        // move item to the correct index with 0 being the first item
                        log('s.reorder_queue > moved id ' + o[1][x].id + ' to position ' + x)
                        chrome.bookmarks.move(o[1][x].id, {parentId: parent_id.toString(), index: x})
                        x = o[1].length + 1
                    }
                }

                if (o[2] >= o[1].length) { // we are done
                    log('s.reorder_queue > Removing information from both queues for id ' + parent_id)
                    setTimeout(function() {
                        s.a.sort_queue.splice(s.a.sort_queue.indexOf(parent_id), 1)
                    }, 500) // remove parent id from global array
                    s.a.reorder_queue.splice(i, 1) // remove information from this array since we are done reordering this folder
                }
                break
            }
        }
    })

    s.status.sort_active--
} // s.reorder_queue

s.resort = function s_resort() {
    s.findAncestors(function() {
        chrome.bookmarks.getChildren('0', function(o) {
            for (var i in o) {
                s.sort(o[i].id, o[i].id, 'recurse')
            }
        })
    })
} // s.resort

s.sort = function s_sort(id, parent_id, recurse, ancestor) {
    id = parseInteger(id)
    parent_id = parseInteger(parent_id === undefined ? id : parent_id)
    recurse = (recurse === undefined) ? false : recurse
    if (id === s.ancestorID.bookmarks_bar || id === s.ancestorID.other_bookmarks || id === s.ancestorID.mobile_bookmarks) {
        ancestor = id // be your own ancestor with time travel!
    }
    ancestor = (ancestor === undefined) ? -1 : parseInteger(ancestor)
    if (ancestor < 0) {
        s.get_ancestor_then_sort(id, id, parent_id, recurse)
    } else {
        chrome.bookmarks.getChildren(parent_id.toString(), function(a) {
            var allow_recurse = true,
                break_sort = false

            if (parent_id === s.ancestorID.bookmarks_bar && !s.option.bookmarks_bar) {
                log('No need to sort Bookmarks Bar root.')
                break_sort = true
                if (!s.option.bookmarks_bar_sub) {
                    // no need for subs either
                    log('No need to sort Bookmarks Bar Sub Folders.')
                    allow_recurse = false
                }
            } else if (ancestor !== parent_id && ancestor === s.ancestorID.bookmarks_bar && !s.option.bookmarks_bar_sub) {
                log('No need to sort Bookmarks Bar Sub Folders.')
                allow_recurse = false
                break_sort = true
            } else if (parent_id === s.ancestorID.other_bookmarks && !s.option.other_bookmarks) {
                log('No need to sort Other Bookmarks root.')
                break_sort = true
                if (!s.option.other_bookmarks_sub) {
                    // no need for subs either
                    log('No need to sort Other Bookmarks Sub Folders.')
                    allow_recurse = false
                }
            } else if (ancestor !== parent_id && ancestor === s.ancestorID.other_bookmarks && !s.option.other_bookmarks_sub) {
                log('No need to sort Other Bookmarks Sub Folders.')
                allow_recurse = false
                break_sort = true
            } else if (parent_id === s.ancestorID.mobile_bookmarks && !s.option.mobile_bookmarks) {
                log('No need to sort Mobile Bookmarks root.')
                break_sort = true
                if (!s.option.mobile_bookmarks_sub) {
                    // no need for subs either
                    log('No need to sort Mobile Bookmarks Sub Folders.')
                    allow_recurse = false
                }
            } else if (ancestor !== parent_id && ancestor === s.ancestorID.mobile_bookmarks && !s.option.mobile_bookmarks_sub) {
                log('No need to sort Mobile Bookmarks Sub Folders.')
                allow_recurse = false
                break_sort = true
            }

            if (allow_recurse && recurse) {
                for (var i in a) {
                    if (a[i].url === undefined) {
                        // we have a folder so recursively call our own function to support unlimited folder depth
                        s.sort(a[i].id, a[i].id, recurse, ancestor)
                    }
                }
            }

            if (break_sort || a.length < 2) {
                // remove folder from the queue but only if the listeners are active (aka we finished the initial import)
                if (s.status.listeners_active) {
                    log('s.sort > No need to reorder, removing parent folder from \'s.a.sort_queue\'')
                    setTimeout(function() {
                        s.a.sort_queue.splice(s.a.sort_queue.indexOf(parent_id).toString(), 1)
                    }, 500)
                }
                return
            }

            if (a.length > 1) { // we have a non-empty folder with more than 1 item so sort it

                // build a string of index values so we can compare against a sorted string to determine if we need to call the reorder function
                var indexBefore = ''

                for (var aI in a) {
                    indexBefore += a[aI].index
                }

                function title(o) {
                    return o.title.toLowerCase()
                }

                function date(o) {
                    return (typeof(o.dateAdded) === 'number') ? o.dateAdded : 0
                }

                function url(o) {
                    var value = o.url

                    if (value === undefined) {
                        value = ''
                    } else {
                        value = o.url.toLowerCase()
                        value = value.replace('http://', '').replace('https://', '').replace('ftp://', '').replace('chrome://', '').replace('www.', '')
                    }

                    return value
                }

                a.sort(function(a, b) {
                    var sort = ''

                    var isFolderA = (a.url === undefined) ? true : false
                    var isFolderB = (b.url === undefined) ? true : false

                    if (s.option.group_folders) { // sort favoring folders first then files
                        if (isFolderA && !isFolderB) {
                            sort = -1
                        } else if (!isFolderA && isFolderB) {
                            sort = 1
                        }
                    }

                    if (sort === '') {
                        var valA, valB

                        if (s.option.group_folders && isFolderA && isFolderB) {
                            // sort by title
                            valA = title(a)
                            valB = title(b)
                        } else {
                            var sortOrder = ''

                            if (parent_id === s.ancestorID.bookmarks_bar) {
                                // bookmarks bar
                                sortOrder = s.option.bookmarks_bar_sort
                            } else if (ancestor !== parent_id && ancestor === s.ancestorID.bookmarks_bar) {
                                // bookmarks bar sub folders
                                sortOrder = s.option.bookmarks_bar_sub_sort
                            } else if (parent_id === s.ancestorID.other_bookmarks) {
                                // other bookmarks
                                sortOrder = s.option.other_bookmarks_sort
                            } else if (ancestor !== parent_id && ancestor === s.ancestorID.other_bookmarks) {
                                // other bookmarks sub folders
                                sortOrder = s.option.other_bookmarks_sub_sort
                            } else if (parent_id === s.ancestorID.mobile_bookmarks) {
                                // mobile bookmarks
                                sortOrder = s.option.mobile_bookmarks_sort
                            } else if (ancestor !== parent_id && ancestor === s.ancestorID.mobile_bookmarks) {
                                // mobile bookmarks sub folders
                                sortOrder = s.option.mobile_bookmarks_sub_sort
                            }

                            if (sortOrder === 'alpha' || sortOrder === '') {
                                valA = title(a)
                                valB = title(b)
                            } else if (sortOrder === 'alphaReverse') {
                                valA = title(b)
                                valB = title(a)
                            } else if (sortOrder === 'date') {
                                valA = date(b)
                                valB = date(a)
                            } else if (sortOrder === 'dateReverse') {
                                valA = date(a)
                                valB = date(b)
                            } else if (sortOrder === 'url') {
                                valA = url(a)
                                valB = url(b)
                            } else if (sortOrder === 'urlReverse') {
                                valA = url(b)
                                valB = url(a)
                            } else {
                                valA = title(a)
                                valB = title(b)
                            }
                        }

                        if (valA < valB) {
                            sort = -1
                        } else if (valA > valB) {
                            sort = 1
                        } else {
                            sort = 0 // default return value (no sorting)

                            // there is a case when two items have the same name they will trade places every sort
                            // to combat this we'll get more and more specific so there will never be a 0 sort order returned

                            // sort on case
                            if (a.title < b.title) {
                                sort = -1
                            } else if (a.title > b.title) {
                                sort = 1
                            } else {
                                // another 0 so let's get even more specific
                                if (a.url < b.url) {
                                    sort = -1
                                } else if (a.url > b.url) {
                                    sort = 1
                                } else {
                                    // item with the earlier id is going to be first
                                    if (a.id < b.id) {
                                        sort = -1
                                    } else {
                                        sort = 1
                                    }
                                }
                            }
                        }
                    }

                    return sort
                })

                var indexAfter = ''

                for (var aJ in a) {
                    indexAfter += a[aJ].index
                }

                if (indexBefore !== indexAfter) {
                    log('s.sort > indexBefore = ' + indexBefore)
                    log('s.sort > indexAfter = ' + indexAfter)
                    s.reorder(a)
                } else {
                    // remove folder from the queue but only if the listeners are active (aka we finished the initial import)
                    if (s.status.listeners_active) {
                        log('s.sort > No need to reorder, removing parent folder from \'s.a.sort_queue\'')
                        setTimeout(function() {
                            s.a.sort_queue.splice(s.a.sort_queue.indexOf(parent_id).toString(), 1)
                        }, 500)
                    }
                }
            }
        })
    }
} // s.sort

s.sort_buffer = function s_sort_buffer(id, parent_id) {
    id = parseInteger(id)
    parent_id = parseInteger(parent_id)
    log('s.sort_buffer > id = ' + id + ', parent_id = ' + parent_id)
    if (s.a.sort_queue.indexOf(parent_id) !== -1) {
        // we are already sorting or have sorted this directory too recently so ignore this request
        log('s.sort_buffer > Parent Folder already in the queue for sorting.')
    } else {
        s.a.sort_queue.push(parent_id) // add parent_id to the array so we can detect and ignore duplicate requests
        // Chrome seems to lock the bookmarks for just an instant after a user does something. We have to be polite and wait to organize them.
        setTimeout(function() {
            s.sort(id, parent_id, undefined) // undefined because we don't want to sort recursively
        }, 500) // half a second
    }
} // s.sort_buffer

//------------
// Party Time
//------------
async function partyTime() {
    await s.install_or_upgrade()
    await s.ready_options()
    chrome.extension.onMessage.addListener(stop_collaborate_and_listen)
    s.init()
}

partyTime()