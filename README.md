# parse-aux-client
Node.js CLI client for the Parse Aux REST service.

For help, run without arguments:

```
$ buddyparse 

Options

  -l, --listVersions              
  -c, --createVersion number      
  -a, --activateVersion number    
  -v, --currentVersion            
```

Environment variable requirements:

- `BUDDY_PARSE_APP_ID`
- `BUDDY_PARSE_MASTER_KEY`

You can then list, create, activate (i.e. switch/rollback) versions. For example, walking through some commands starting from scratch:

```
$ mkdir ExampleParseApp

$ cd ExampleParseApp 

$ mkdir public cloud

$ cat > cloud/main.js
console.log("Hello!");

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -l
Listing application versions...
[]

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -c 1
Walking local public directory subtree...
Listing existing hash blobs...
0 public assets already synchronized!
Uploading cloud code...
Uploading name → hash mapping...
Setting active version...
All done!

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -l  
Listing application versions...
[ 1 ]

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -v
Fetching current version...
1

$ date > public/foo.txt

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -c 2
Walking local public directory subtree...
Listing existing hash blobs...
Uploading 1 (of 1) public asset(s)...
Uploading cloud code...
Uploading name → hash mapping...
Setting active version...
All done!

$ date > public/bar.txt                                                            

$ cat > cloud/main.js 
console.log("And now for something completely different.");

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -c 3
Walking local public directory subtree...
Listing existing hash blobs...
Uploading 1 (of 2) public asset(s)...
Uploading cloud code...
Uploading name → hash mapping...
Setting active version...
All done!

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -v  
Fetching current version...
3

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -a 2
Setting active version...
done

$ env BUDDY_PARSE_APP_ID=example-app BUDDY_PARSE_MASTER_KEY=test123 buddyparse -v  
Fetching current version...
2

$ curl http://example-app.parse-static.buddy.com/data/foo.txt 
Tue 19 Apr 2016 02:36:34 ACST
```
