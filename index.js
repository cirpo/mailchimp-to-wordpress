var async = require('async');
var chalk = require('chalk');
var cheerio = require('cheerio');
var q = require('bluebird');
var request = require('request');
var requestp = require('request-promise');

var config = require('./config.js');

var get_issue_id = function(url) {
    var matches = url.match('/\?u=' + config.mailchimpUID + '&id=(.*)');
    return (matches && matches.length > 1) ? matches[1] : '';
};

var mailchimpOpts = {
    method: 'GET',
    url: config.mailchimpArchiveUrl + '&show=' + config.mailchimpArchiveShow
};

console.log(chalk.bold.green('### STARTED ###'));

request(mailchimpOpts, function (error, response, jscode) {
    console.log('getting list of issues from Mailchimp');
    if (!error && response.statusCode == 200) {

        var issuesURL = [];

        var htmlcode = '<html><body>' + eval(jscode.replace(/^document.write\(/,'').replace(/\);$/,'')) + '</body></html>';
        var $ = cheerio.load(htmlcode);
        $('.campaign a').each(function(i,elem){
            issuesURL.push($(elem).attr('href'));
        });

        // debug: trim the array
        // issuesURL.length = 4;

       console.log('you have ' + chalk.bold.cyan(issuesURL.length) + ' issues in Mailchimp\'s archive');

        var wpOptsList = {
            method: 'GET',
            url: config.wpApiUrl + '/posts',
            json: true
        };

        request(wpOptsList, function (error, response, posts) {
            if (!error && response.statusCode == 200) {

                var postsIssuesUID = [];

                // get already saved issues/posts using the 'mailchimp_id' meta as identifier
                posts.forEach(function(post){
                    if(post.mailchimp_id && post.mailchimp_id.length > 0) {
                        postsIssuesUID.push(post.mailchimp_id[0]);
                    }
                });

                console.log('you have ' + chalk.bold.yellow(postsIssuesUID.length) + ' issues already in Wordpress');

                // get the issues that have not yet been saved
                var issuesMissing = [];
                issuesURL.forEach(function(url){
                    var uid = get_issue_id(url);
                    if(postsIssuesUID.indexOf(uid) < 0) {
                        issuesMissing.push(url);
                    }
                });

                console.log('going to add ' + chalk.bold.magenta(issuesMissing.length) + ' issues to Wordpress');

                // set up our queue (with max two parallel request otherwise the database returns because overloaded)
                var queue = async.queue(function(issueURL, callback) {

                    console.log(chalk.bold.green('>>> importing issue ' + issueURL));

                    request({method:'GET',url:issueURL,normalizeWhitespace:true}, function (error, response, htmlcode) {
                        console.log(chalk.bold.green('>>> importing issue ' + issueURL));
                        if (!error && response.statusCode == 200) {

                            var $ = cheerio.load(htmlcode);
                            // store the issue date
                            var issueDate = $('#templateHeader h5').text().replace(/^Issue: /,'');
                            // store the issue categories
                            var issueTags = [];
                            $('#templateColumns h5').each(function(i, el) { // this is a Cheerio each!
                                var tag = $(el).text().trim();
                                if(tag) {
                                    issueTags.push(tag);
                                }
                            });
                            // remove the header, footer and other strange things
                            $('#templatePreheader').remove();
                            $('#templateHeader').remove();
                            $('#templateFooter').remove();
                            $('#awesomewrap').remove();
                            // replace the IDs with classes
                            $('#bodyTable').addClass('bodyTable').removeAttr('id');
                            $('#bodyCell').addClass('bodyCell').removeAttr('id');
                            $('#templateContainer').addClass('templateContainer').removeAttr('id'); // will be replaced later
                            $('#templateBody').addClass('templateBody').removeAttr('id');
                            $('#templateColumns').addClass('templateColumns').removeAttr('id');
                            // cleanup all inline styles, decoration attributes, etc.
                            $('[style]').removeAttr('style');
                            $('[width]').removeAttr('width');
                            $('[height]').removeAttr('height');
                            $('[align]').removeAttr('align');
                            $('[valign]').removeAttr('valign');
                            $('[cellspacing]').removeAttr('cellspacing');
                            $('[cellpadding]').removeAttr('cellpadding');
                            $('[border]').removeAttr('border');
                            // extract the partial elements
                            var partImage = $('.mcnImageContent').html();
                            var partCaption = $('.mcnImageBlock + .mcnTextBlock .mcnTextContent').html();
                            var partCol1 = $('.leftColumnContainer .mcnTextContent').html();
                            var partCol2 = $('.rightColumnContainer .mcnTextContent').html();
                            // build a new HTML chunk (and assign a class for the version of the template)
                            htmlchunk = '<div class="readingsBlock v1">';
                            htmlchunk += '    <div class="iotd">';
                            htmlchunk += '        <h5>IMAGE OF THE DAY</h5>';
                            htmlchunk += '        <div class="figure">' + partImage + '</div>';
                            if(partCaption) {
                                htmlchunk += '        <div class="caption">' + partCaption + '</div>';
                            }
                            htmlchunk += '    </div>';
                            htmlchunk += '    <div class="cols">';
                            htmlchunk += '        <div class="col">' + partCol1 + '</div>';
                            htmlchunk += '        <div class="col">' + partCol2 + '</div>';
                            htmlchunk += '    </div>';
                            htmlchunk += '</div>';
                            // strip invisible spacing characters (e.g. &#xA0;)
                            htmlchunk = htmlchunk.replace(/&#xA0;/g,' ');

                            // get the issue date in different formats (the RFL date is in dd-mm-yy format)
                            var issueDateParts = issueDate.split('/');
                            var issueDateIso = new Date('20' + issueDateParts[2], issueDateParts[1]-1, issueDateParts[0], '12', '30', '00'); // Note: months are 0-based
                            // replace the numeric month with a string
                            issueDateParts[1] = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(issueDateParts[1]-1)];
                            // expose the full year
                            issueDateParts[2] = '20' + issueDateParts[2];

                            // prepare the wp-post data
                            var wpOptsCreate = {
                                method: 'POST',
                                url: config.wpApiUrl + '/posts',
                                headers: { 'Authorization': 'Basic ' + Buffer(config.wpAppUser + ':' + config.wpAppPass).toString('base64') },
                                json: true,
                                body: {
                                    date: issueDateIso,
                                    slug: issueDateParts.join('-').toLowerCase(),
                                    title: 'Readings for Lunch — [ ' + issueDateParts.join(' ') + ' ]',
                                    content: htmlchunk,
                                    status: 'publish',
                                    comment_status: 'closed',
                                    format: 'standard',
                                    // tags: issueTagsId,
                                    // tags: issueTags.join(','),
                                    // post_meta: [{ 'mailchimp_url' : issueURL }], // not working anymore :(
                                    author: 1
                                }
                            };

                            // create the post
                            request(wpOptsCreate, function (error, response, body) {
                                if (!error && response.statusCode == 201) { // HTTP code = created
                                    console.log('posted issue ' + chalk.bold.blue(issueDate) + ' (' + chalk.bold.white('ID #' + body.id) + ') - ' + body.link);

                                    var postId = body.id;

                                    // prepare the meta data
                                    var wpOptsMeta = {
                                        method: 'POST',
                                        url: config.wpApiUrl + '/posts/' + postId + '/meta',
                                        headers: { 'Authorization': 'Basic ' + Buffer(config.wpAppUser + ':' + config.wpAppPass).toString('base64') },
                                        json: true,
                                        body: {
                                            key: 'mailchimp_id',
                                            value : get_issue_id(issueURL)
                                        }
                                    };

                                    // add the meta data
                                    request(wpOptsMeta, function (error, response, body) {
                                        if (!error && response.statusCode == 201) { // HTTP code = created
                                            console.log('posted metadata for ID #' + postId);
                                        } else {
                                            console.log(chalk.bold.red('post metadata for ID #' + postId + ' failed'));
                                            console.log('response: ', response);
                                            console.log('error dump: ', error);
                                        }
                                    });

                                    // add the tags to the taxonomy (if not exist yet) and then associate it to the post
                                    var proms = [];
                                    var tagIDs = [];
                                    issueTags.forEach(function(tag) {

                                        // prepare the wp-post data
                                        var wpOptsTags = {
                                            method: 'POST',
                                            url: config.wpApiUrl + '/tags',
                                            headers: { 'Authorization': 'Basic ' + Buffer(config.wpAppUser + ':' + config.wpAppPass).toString('base64') },
                                            json: true,
                                            body: { name: tag }
                                        };

                                        var prom = requestp(wpOptsTags)
                                            .then(function (response) {
                                                // POST succeeded...
                                                var tagID = response.id;
                                                console.log('tag ' + chalk.bold.white(tag) + ' created with ID #' + tagID);
                                                tagIDs.push(tagID);
                                            })
                                            .catch(function (error) {
                                                // POST failed...
                                                if(error.error && error.error.code == 'term_exists') {
                                                    var tagID = error.error.data;
                                                    console.log('tag ' + tag + ' already exist with ID #' + tagID);
                                                    tagIDs.push(tagID);
                                                } else {
                                                    console.log('error dump: ', error);
                                                }
                                            });

                                        proms.push(prom);

                                    });

                                    q.all(proms).then(function(results){

                                        // add the tags to the post
                                        if (tagIDs.length > 0) {

                                            // prepare the tags
                                            var wpOptsUpdate = {
                                                method: 'POST',
                                                url: config.wpApiUrl + '/posts/' + postId,
                                                headers: { 'Authorization': 'Basic ' + Buffer(config.wpAppUser + ':' + config.wpAppPass).toString('base64') },
                                                json: true,
                                                body: {
                                                    append: true,
                                                    tags: tagIDs
                                                }
                                            };

                                            // add the tags
                                            request(wpOptsUpdate, function (error, response, body) {
                                                if (!error && response.statusCode == 200) { // HTTP code = created
                                                    console.log('posted tags for ID #' + postId);
                                                } else {
                                                    console.log(chalk.bold.red('post tags for ID #' + postId + ' failed'));
                                                    console.log('response: ', response);
                                                    console.log('error dump: ', error);
                                                }
                                                callback();
                                            });

                                        } else {
                                            callback();
                                        }

                                    });

                                } else {
                                    console.log(chalk.bold.red('post to WP failed with code ' + response.statusCode));
                                    console.log('response: ', response);
                                    console.log('error dump: ', error);
                                }

                            });

                        }
                    });

                }, 2); // only allow 2 requests at a time

                // push the list of missing issues/urls to the queue
                queue.push(issuesMissing);

            }
        });

    }
});