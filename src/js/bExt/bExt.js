// 
//  bExt.js
//  bitly_chrome_extension
//  
//  Created by gregory tomlinson on 2011-04-07.
//  Copyright 2011 the public domain. All rights reserved.
// 



(function(window, undefined) {
    


window.bExt={
    // bExt.match_host
    'api' : null,
    'db' : null,
    'events' : null,
    'is_chrome' : chrome&&chrome.tabs ? true : false,
    'context_menu' : false,
    
        
    match_host : function(url_str) {
        // todo, weakness, not all URLs start with HTTP/HTTPs 
        var matches = url_str && url_str.trim().match(/^http(?:s)?:\/\/([^/]{2,})\/?.*$/i);
        return matches && matches.pop();
    },    
    init_db : function() {
        try {
            bExt.db=sqlDB("bitly_local_db");            
        } catch(e) {return false;}
        return true;

    },
    
    set_popup : function() {
        if(bExt.is_chrome) {
            chrome.browserAction.setPopup({ "popup" : "popup.html"});
        } else {
            console.log("not chrome, didn't set popup");
        }

    },
    
    // bExt.sign_in
    sign_in : function( username, password, callback ) {
        
        if(!bExt._api_instance) {
            bExt.init_api();
        }
        bExt.api.auth(username, password, function(response) {
            
            var auth = response, current_user;
            if(auth && auth.login !== "" ) {
                current_user = {
                    "x_login": auth.login,
                    "x_apiKey": auth.apiKey,
                    "access_token" : auth.access_token
                }
                bExt.info.set("user_data", current_user);                
                bExt.md5_domains();
                bExt.trends.init();
                bExt.set_popup();
            }
            if(callback) { callback(response); }
        
        });
        
    },
    
    sign_out : function() {
        bExt.api.remove_credentials();
        // auto_expand_urls = true;
        // enhance_twitter_com=true;
        
        bExt._clear_signin_data();
        bExt.api.set_domain("bit.ly");
        
        // bail on worker
        bExt.trends.exit();
        
        chrome.browserAction.setPopup({ "popup" : ""});
        return;
    },
    
    _clear_signin_data : function() {
        bExt.info.clear("realtime");
        bExt.info.clear("note_blacklist");
        bExt.info.clear("notifications");
        bExt.info.clear("stash");
        bExt.info.clear("popup_history");

        bExt.info.clear("user_data");
        bExt.info.clear("share_accounts"); //  we don't store share accounts in SQL
        bExt.info.clear("no_expand_domains");            

        bExt.db.remove("notifications", delete_sql_handler );
        bExt.db.remove("no_expand_domains", delete_sql_handler );
        bExt.db.remove("user_data", delete_sql_handler );
        bExt.db.remove("domain", delete_sql_handler );
        bExt.db.remove("auto_expand_urls", delete_sql_handler );
        bExt.db.remove("enhance_twitter_com", delete_sql_handler );        
    },
    
    add_righclick : function() {
        if(!bExt.context_menu) {
            var params = {
                'type' : 'normal',
                'title' : 'Shorten and copy link with bitly',
                'contexts' : ["link"],
                'onclick' : _contextmenu_on_link_click,
                'documentUrlPatterns' : ['http://*/*', 'https://*/*']
            }
            // todo, chrome specific
            if(bExt.is_chrome) {
                chrome.contextMenus.create(params, function() {});                            
            } else {
                console.log("not chrome, no context menu added")
            }

            bExt.context_menu=true;
        }
    },
    
    evt_rightclick : function(info, tab) {
        var long_url = info.linkUrl && info.linkUrl.trim(), expand_meta_data;
        if(long_url !== "" ) {
            bExt.api.shorten( info.linkUrl.trim(), function(jo) {
                if(jo && jo.status_txt && jo.status_txt === "ALREADY_A_BITLY_LINK") {
                   _util_expand_and_reshorten( long_url  );
                } else if(jo && jo.url && jo.url !== "") {
                    // can I get a callback from this? -- check if it's true?
                    copy_to_clip(jo.url);
                    contextmenu_inject_pagebanner( tab.id );
                }
            }); 
        }        
    },
    
    evt_button_listen : function( curr_tab ) {
        if(bExt.is_chrome) {
            chrome.tabs.create( { 'url' : chrome.extension.getURL( "options.html" ) });                    
        } else {
            console.log("didn't open the chrome tab for optiions inoroder to login")
        }

    },
    
    // start the bitly API ref
    init_api : function() {
        if(!bitly_oauth_credentials || !bitly_oauth_credentials.client_id) { return false; }
        
        // create a new instance
        if(!bExt._api_instance) {
            bExt._api_instance=true;
            bExt.api=new bitlyAPI( bitly_oauth_credentials.client_id, bitly_oauth_credentials.client_signature );
        }
        
        var user_data = bExt.info.get("user_data");
        if(user_data && user_data.x_login && user_data.x_apiKey) {
            bExt.api.set_credentials( user_data.x_login, user_data.x_apiKey, user_data.access_token );
        } else {
            return false;
        }

        return true;
    },
    
    md5_domains : function() {
        bExt.api.bitly_domains( bExt.hovercard.store_md5domains );        
    },
    
    // notifications preferences (settings and whatnot)
    note_prefs : function() {
        var default_pref = { 'enabled' : true, 'threshold' : 20, "interval" : 1, "interval_type" : 'hour' };
        return bExt.info.get("note_preferences") || default_pref;
    },
    
    // get all the notes resolves
    note_resolve : function( short_urls ) {
        var r_time = bExt.info.get("realtime"), 
            bit_result, i=0, black_list=[], active_links = [],
            notes_list = [], l_notes = bExt.info.get("notifications") || [],
            prefs = bExt.note_prefs();

        if(short_urls.length <= 0 ) { return; }
        r_time = r_time && r_time.realtime_links || [];

        bExt.api.expand_and_meta( short_urls, function(jo) {
            // add to the notifications, remove from the list...

            for(var k in jo.expand_and_meta) {
                bit_result = jo.expand_and_meta[k];

                for(i=0;i<r_time.length;i++) {
                    if(r_time[i].user_hash === bit_result.user_hash) {
                        bit_result.trend_clicks = r_time[i].clicks;
                    }
                }

                if(bit_result.trend_clicks > prefs.threshold) {
                    black_list.push( bit_result.short_url );
                    notes_list.push( bit_result );
                }
            }

            l_notes = l_notes.concat(notes_list);
            bExt.info.set("notifications", l_notes);

            if(l_notes.length > 0 ) {
                bitNote.show();
            }

            bExt.trends.update_links( black_list, bExt.api.bit_request.access_token );
            bExt.trends.expire_links();

        });        
    },
    

    
    //
    
        
    // bExt.user    
    'info' : {
        /*
            enhance_twitter_com
            auto_expand_urls
            user_data = localfetch("user_data");
        */
        
        'get' : function(key) {
            if(!this.__data[key]) {
                // get from cache, store it
                this.__data[key]=this.__get(key);
            }
            return this.__data[key];
        },
        '__get' : function(itemKey) {
            var item = window.localStorage.getItem( itemKey );
            try{
                return JSON.parse(item);
            } catch(e) { return item; }          
        },
        'set' : function(k,v) {
            this.__data[k]=v;
            try{
                window.localStorage.setItem( k, window.JSON.stringify( v ) );
                return true;
            } catch(e) {}
            return false;   
        },
        '__data' : {},
        'load_cache' : function() {
            // everything from the cache
        },
        
        'clear' : function(itemKey) {
            try {
                window.localStorage.removeItem( itemKey );
                return true;
            } catch(e){ return false; }
            return false;            
        }
    }
}


/*
    Trends
        -- workers etc
*/

bExt.trends = {
    
    worker : null,
    
    init : function() {
        bExt.trends.expire_links();
        if(!bExt.trends.worker) {
            console.log("Trends worker created");
            bExt.trends.worker = new Worker("js/workers/realtime_data.js");
            bExt.trends.worker.onmessage = bExt.trends.m_evt;            
        }
        setTimeout(bExt.trends.watch, 100);
    },
    
    exit : function() {
        if(bExt.trends.worker) {
            bExt.trends.worker.terminate();
            bExt.trends.worker=null;
        }
        
        return true;
    },
    
    m_evt : function(evt) {
        var lists, i, black_list=[], prefs=bExt.note_prefs(), item;
        console.log("message calls back");
        if(!evt.data.trending_links) {
            return;
        }
        bExt.info.set("realtime", evt.data.trending_links );
        lists = evt.data.remove_list || [];
        for( i=0,item; item = lists[i]; i++ ) {
            black_list.push( item.short_url );
        }
        if(prefs.enabled) {
            bExt.note_resolve( evt.data.notifications  );
        }        
    },
    
    watch : function() {
        // watch and alert
        console.log("trending interval check started");
        if(!bExt.api.bit_request.access_token) {
            console.log("no token to poll with");
            // throw an error here.... 
            return;
        }
        
        var black_list=[], 
            note_blacklist = bExt.info.get("note_blacklist") || [], 
            params = {
                'oauth_key' : bExt.api.bit_request.access_token,
                'black_list' : note_blacklist,
                'action' : 'start'
            }
        bExt.trends.worker.postMessage( params );        
    },
    
    update_links : function( black_list, bitly_token ) {
        if(black_list.length > 0) {            
            var note_b_list = bExt.info.get("note_blacklist") || [],
                params = {
                    'oauth_key' : bitly_token, // keep passing this in...
                    'black_list' : note_b_list.concat( black_list ),
                    'action' : 'update'
                }
            if(bExt.trends.worker) {
                bExt.trends.worker.postMessage( params );  // Updating the worker                
            } else {
                console.log("no trends worker");
            }

        }        
    },
    
    expire_links : function() {
        // expire blacklinks
        var notes = bExt.info.get("note_blacklist") || [], 
            new_notes=[], i, j, note,
            r_time = bExt.info.get("realtime");

        r_time = r_time && r_time.realtime_links || [];

        outerLoop_expire:
        for(i=0, note; note=notes[i]; i++) {
            for(j=0; j<r_time.length; j++) {

                if( note.indexOf( r_time[j].user_hash ) > -1  ) {
                    new_notes.push(  note );                
                    continue outerLoop_expire;
                }
            }

        }
        bExt.info.set("note_blacklist", new_notes);        
    }
}


function _util_expand_and_reshorten( long_url ) {
    bExt.api.expand( long_url, function(jo) {
        expand_meta_data = jo&&jo.expand&&jo.expand.pop();
        if(!expand_meta_data) { return; } // todo, bubble error??
        bExt.api.shorten( expand_meta_data.long_url, function(jo) {
            if(jo && jo.url && jo.url !== "") {
                copy_to_clip(jo.url);                                    
            }
        });
    });    
}

function copy_to_clip( str_value  ) {
    var txt_area = $("instant_clipboad_copy_space") || document.body.appendChild( fastFrag.create({
        id : "instant_clipboad_copy_space"
    }) );
    try {
        txt_area.value=str_value;
        txt_area.select();
        document.execCommand("copy", false, null);  
    } catch(e){}            
}

function contextmenu_inject_pagebanner( tab_id  ) {
    
    if(bExt.is_chrome) {
        chrome.tabs.executeScript(tab_id, {
            file : "js/content_scripts/bitly.contextMenuNotification.js"
        });
    } else {
        console.log("not chrome, context menu not injected");
    }

}




// todo,
// move this elsewhere
Function.prototype._scope = function( scope ) {
    var self=this;
    return function() { self.apply( scope, Array.prototype.slice.call( arguments, 0 ) ); }
}


window.bExt.cache = {
    
    // handle loading the local cache on application start
    // todo, add methods in signout here... 
    
}

/*
    Sharing

*/
window.bExt.share = {
    
    // get the current Social Network Accounts associated w/ bitly account
    // 'cache' this data into localstorage to speed up requests
    accounts : function( callback ) {
        var user_share_accounts = bExt.info.get("share_accounts");
        if(!user_share_accounts) {
            bExt.share.sync( callback );
        } else {
            callback( user_share_accounts )
        }        
    },
    
    // toggle specific social accounts on and off
    toggle : function( callback  ) {
        var user_share_accounts = bExt.info.get("share_accounts"),
            accounts = user_share_accounts && user_share_accounts.share_accounts,
            i=0, account, flag=false;
        
        for( ; account=accounts[i]; i++) {
            if(account.account_id === request.account_id) {
                account.active = request.active;
                flag = true;
                break;
            }
        }
        bExt.info.set("share_accounts", user_share_accounts);
        callback(user_share_accounts);
    },
    
    // Get the latest Social Accounts from remote bitly
    sync : function( callback ) {
        var account, accounts, i=0;
        bExt.api.share_accounts( function( jo ) {
            if (jo.status_code === 403) {
                
                bExt.sign_out(); // issue #8, explicitly sign out!
                jo.error = true;
                callback(jo)
                return;
            }

            accounts = jo && jo.share_accounts;
            if(accounts) {
                for( ; account=accounts[i]; i++) {
                    account.active=true;
                }
                bExt.info.set("share_accounts", jo);
            }
            callback(jo);

        });        
    },
    
    send : function( message, callback ) {
        var a = bExt.info.get("share_accounts"),
            accounts = a && a.share_accounts || [],
            i=0, account, share_ids = [], params = {};

        for( ; account=accounts[i]; i++) {
            if(account.active) {
                share_ids.push( account.account_id );
            }
        }
        if(message.trim() === "" || share_ids.length <= 0 ) {
            callback({'error' : 'no active accounts'})
            return;
        }

        params.account_id = share_ids;
        params.share_text = message;
        
        // make the HTTP remote request
        bExt.api.share( params, function(jo) {
            if (jo.status_code === 403) {
                // issue #8, explicitly sign out!
                bExt.sign_out();
                jo.error = true;
            }
            callback(jo);
        });
    }
    
}


})(window);

/*  EOF */
